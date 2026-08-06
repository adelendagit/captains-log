const express = require("express");
const { fetchBoard } = require("../services/trello");
const { mobileBearerAuthentication } = require("../services/mobileAuth");
const {
  appendJourneyComment,
  buildPositionComment,
  createJourney,
  endJourney,
  fetchJourneyCards,
  fetchJourneyComments,
  findActiveJourney,
  parseJourneyDescription,
  parsePositionComment,
} = require("../services/journeys");

const router = express.Router();
const CARD_ID_PATTERN = /^[a-f0-9]{24}$/i;

router.use(mobileBearerAuthentication);

function getMemberId(user) {
  return user?.id || user?.idMember || user?.profile?.id || null;
}

async function requireBoardMember(req, res) {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }

  const memberId = getMemberId(req.user);
  const verifiedAt = Number(req.session?.boardMemberVerifiedAt || 0);
  const cachedMemberId = req.session?.boardMemberId;
  if (
    memberId &&
    cachedMemberId === memberId &&
    Date.now() - verifiedAt < 10 * 60 * 1000
  ) {
    return memberId;
  }

  const { members = [] } = await fetchBoard();
  const member = members.find(
    (candidate) =>
      candidate.id === memberId &&
      ["admin", "normal"].includes(candidate.memberType),
  );
  if (!member) {
    res.status(403).json({ error: "Not a member of this Trello board" });
    return null;
  }

  req.session.boardMemberId = memberId;
  req.session.boardMemberVerifiedAt = Date.now();
  return memberId;
}

function normalizePosition(body) {
  const lat = Number(body?.lat ?? body?.latitude);
  const lng = Number(body?.lng ?? body?.longitude);
  const timestamp = body?.timestamp ? new Date(body.timestamp) : new Date();

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    const error = new Error("Invalid latitude");
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    const error = new Error("Invalid longitude");
    error.status = 400;
    throw error;
  }
  if (
    Number.isNaN(timestamp.getTime()) ||
    timestamp.getTime() > Date.now() + 5 * 60 * 1000
  ) {
    const error = new Error("Invalid timestamp");
    error.status = 400;
    throw error;
  }

  const optionalNumber = (key, { min = -Infinity, max = Infinity } = {}) => {
    if (body?.[key] == null || body[key] === "") return null;
    const value = Number(body[key]);
    if (!Number.isFinite(value) || value < min || value > max) {
      const error = new Error(`Invalid ${key}`);
      error.status = 400;
      throw error;
    }
    return value;
  };

  const sampleId = body?.sampleId ? String(body.sampleId).trim() : null;
  if (sampleId && !/^[a-zA-Z0-9_-]{8,100}$/.test(sampleId)) {
    const error = new Error("Invalid sampleId");
    error.status = 400;
    throw error;
  }

  return {
    timestamp: timestamp.toISOString(),
    lat,
    lng,
    accuracy: optionalNumber("accuracy", { min: 0, max: 10000 }),
    speedKts: optionalNumber("speedKts", { min: 0, max: 100 }),
    course: optionalNumber("course", { min: 0, max: 360 }),
    altitude: optionalNumber("altitude", { min: -1000, max: 20000 }),
    sampleId,
    source: "ios",
  };
}

router.get("/current", async (req, res, next) => {
  try {
    const active = findActiveJourney(await fetchJourneyCards());
    if (!active) {
      res.set("Cache-Control", "public, max-age=15");
      return res.json({ active: false });
    }

    const actions = await fetchJourneyComments(active.card.id, 100);
    const track = actions
      .map((action) => parsePositionComment(action.data?.text))
      .filter(Boolean)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const position = track[track.length - 1] || null;

    res.set("Cache-Control", "public, max-age=15");
    res.json({
      active: true,
      journey: {
        id: active.card.id,
        name: active.card.name,
        startedAt: active.metadata.startedAt,
      },
      position,
      track,
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.post("/start", async (req, res, next) => {
  try {
    const memberId = await requireBoardMember(req, res);
    if (!memberId) return;

    const existing = findActiveJourney(await fetchJourneyCards());
    if (existing) {
      return res.status(409).json({
        error: "A journey is already active",
        journey: { id: existing.card.id, name: existing.card.name },
      });
    }

    const startedAt = req.body?.startedAt
      ? new Date(req.body.startedAt)
      : new Date();
    if (
      Number.isNaN(startedAt.getTime()) ||
      startedAt.getTime() > Date.now() + 5 * 60 * 1000
    ) {
      return res.status(400).json({ error: "Invalid start time" });
    }

    const suppliedName = String(req.body?.name || "").trim();
    if (suppliedName.length > 160) {
      return res.status(400).json({ error: "Journey name is too long" });
    }
    const fallbackDate = startedAt.toISOString().slice(0, 16).replace("T", " ");
    const name = suppliedName || `Journey · ${fallbackDate} UTC`;
    const card = await createJourney(req.user, {
      name,
      startedAt: startedAt.toISOString(),
      startedBy: memberId,
    });

    res.status(201).json({
      success: true,
      journey: { id: card.id, name: card.name, startedAt: startedAt.toISOString() },
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.post("/:cardId/positions", async (req, res, next) => {
  try {
    const memberId = await requireBoardMember(req, res);
    if (!memberId) return;
    if (!CARD_ID_PATTERN.test(req.params.cardId)) {
      return res.status(400).json({ error: "Invalid journey ID" });
    }

    const cards = await fetchJourneyCards();
    const card = cards.find((candidate) => candidate.id === req.params.cardId);
    const metadata = card && parseJourneyDescription(card.desc);
    if (!card || metadata?.status !== "active") {
      return res.status(404).json({ error: "Active journey not found" });
    }

    const position = normalizePosition(req.body);
    const startedAt = new Date(metadata.startedAt);
    if (
      !Number.isNaN(startedAt.getTime()) &&
      new Date(position.timestamp) < new Date(startedAt.getTime() - 15 * 60 * 1000)
    ) {
      return res.status(400).json({ error: "Position predates this journey" });
    }

    await appendJourneyComment(
      req.user,
      card.id,
      buildPositionComment(position),
    );
    res.status(201).json({ success: true, position, acceptedBy: memberId });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

router.post("/:cardId/end", async (req, res, next) => {
  try {
    const memberId = await requireBoardMember(req, res);
    if (!memberId) return;
    if (!CARD_ID_PATTERN.test(req.params.cardId)) {
      return res.status(400).json({ error: "Invalid journey ID" });
    }

    const cards = await fetchJourneyCards();
    const card = cards.find((candidate) => candidate.id === req.params.cardId);
    const metadata = card && parseJourneyDescription(card.desc);
    if (!card || metadata?.status !== "active") {
      return res.status(404).json({ error: "Active journey not found" });
    }

    const endedAt = req.body?.endedAt ? new Date(req.body.endedAt) : new Date();
    if (
      Number.isNaN(endedAt.getTime()) ||
      endedAt.getTime() > Date.now() + 5 * 60 * 1000 ||
      endedAt < new Date(metadata.startedAt)
    ) {
      return res.status(400).json({ error: "Invalid end time" });
    }

    await endJourney(req.user, card, {
      endedAt: endedAt.toISOString(),
      endedBy: memberId,
    });
    res.json({ success: true, endedAt: endedAt.toISOString() });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

module.exports = router;
