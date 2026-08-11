const express = require("express");
const router = express.Router();
const axios = require("axios");
const crypto = require("crypto");
const oauth1a = require("oauth-1.0a");
const {
  fetchBoard,
  fetchBoardWithAllComments,
  fetchAllComments,
  fetchCommentPage,
  fetchRecentComments,
  fetchBoardWithCredentials,
  invalidateBoardCache,
  invalidateCommentCache,
} = require("../services/trello");
const { ACTION_LABELS, sendLogNotification } = require("../services/email");
const {
  buildPlanningRoute,
  classifyPlanningPoint,
} = require("../services/planningRoute");
const { buildSeaRoute } = require("../services/seaRoute");
const {
  createJourney,
  endJourney,
  fetchJourneyCards,
  findActiveJourney,
} = require("../services/journeys");
const {
  findAttachedPlaceCard,
  findPlanList,
  isReservedList,
  parseLegacyPlanMetadata,
  removeLegacyPlanMetadata,
  resolvePlanPlaceCard,
} = require("../services/plans");

let currentStopCache = null;
let currentStopCacheExpiresAt = 0;
let currentStopRequest = null;

function extractTimestamp(text, fallback, cardId) {
  const match = text.match(/timestamp:\s*([0-9T:\- ]+)/i);
  if (match) {
    const ts = match[1].trim().replace(" ", "T");
    const d = new Date(ts.length === 16 ? ts + ":00" : ts);
    //console.log(`cardId: ${cardId} timestamp found old: ${ts}, new: ${d}, fallback: ${fallback}`);
    if (!isNaN(d)) return d.toISOString();
  }
  return fallback;
}

function extractTemperature(text) {
  const value = String(text || "");
  const metadataMatch = value.match(
    /^temperature:\s*(-?\d+(?:\.\d+)?)\s*(?:°\s*C?)?\s*$/im,
  );
  const headlineMatch = value.match(
    /^\s*(-?\d+(?:\.\d+)?)\s*°(?:\s*C)?(?:\s*$|\s*\n)/i,
  );
  const temperature = Number((metadataMatch || headlineMatch)?.[1]);
  return Number.isFinite(temperature) ? temperature : null;
}

function extractMooring(text) {
  const match = String(text || "").match(/^mooring:\s*(.+?)\s*$/im);
  return match?.[1]?.trim() || null;
}

// existing number helper
function getCFNumber(card, boardCFs, name) {
  const def = boardCFs.find((f) => f.name === name);
  if (!def) return null;
  const item = (card.customFieldItems || []).find(
    (i) => i.idCustomField === def.id,
  );
  return item?.value?.number ? Number(item.value.number) : null;
}
// updated text/dropdown helper:
function getCFTextOrDropdown(card, boardCFs, name) {
  const def = boardCFs.find((f) => f.name === name);
  if (!def) return null;
  const item = (card.customFieldItems || []).find(
    (i) => i.idCustomField === def.id,
  );
  if (!item) return null;

  // If it's a text field:
  if (item.value?.text != null) {
    return item.value.text;
  }

  // If it's a dropdown, Trello gives you idValue:
  if (item.idValue && Array.isArray(def.options)) {
    const opt = def.options.find((o) => o.id === item.idValue);
    return opt?.value?.text ?? null;
  }

  return null;
}

function normalizeNavilyUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch (_error) {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!["navily.com", "www.navily.com"].includes(hostname)) return null;
  if (!["http:", "https:"].includes(parsed.protocol)) return null;
  if (!parsed.pathname || parsed.pathname === "/") return null;
  parsed.protocol = "https:";
  parsed.hostname = "www.navily.com";
  parsed.port = "";
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString();
}

function isBoardMember(user, members = []) {
  const userId = user?.id || user?.idMember || user?.profile?.id;
  return members.some(
    (member) =>
      member.id === userId &&
      (member.memberType === "admin" || member.memberType === "normal"),
  );
}

function buildPlaceLists(lists = []) {
  return lists
    .filter((list) => !isReservedList(list))
    .map((list) => ({ id: list.id, name: list.name }));
}

function trelloOAuth(user) {
  const credentials = {
    consumer_key: process.env.TRELLO_OAUTH_KEY,
    consumer_secret: process.env.TRELLO_OAUTH_SECRET,
    token: user.token,
    token_secret: user.tokenSecret,
  };
  const client = oauth1a({
    consumer: {
      key: credentials.consumer_key,
      secret: credentials.consumer_secret,
    },
    signature_method: "HMAC-SHA1",
    hash_function(baseString, key) {
      return crypto.createHmac("sha1", key).update(baseString).digest("base64");
    },
  });
  return { client, credentials };
}

function trelloHeaders(user, url, method, data) {
  const { client, credentials } = trelloOAuth(user);
  return client.toHeader(
    client.authorize(
      { url, method, data },
      { key: credentials.token, secret: credentials.token_secret },
    ),
  );
}

async function updateTrelloCard(user, cardId, values) {
  const url = `https://api.trello.com/1/cards/${cardId}`;
  const headers = trelloHeaders(user, url, "PUT", values);
  const response = await axios.put(url, null, { params: values, headers });
  invalidateBoardCache();
  return response.data;
}

async function createTrelloCardAttachment(user, cardId, placeCard) {
  const url = `https://api.trello.com/1/cards/${cardId}/attachments`;
  const values = { name: placeCard.name, url: placeCard.shortUrl };
  const headers = trelloHeaders(user, url, "POST", values);
  const response = await axios.post(url, null, { params: values, headers });
  invalidateBoardCache();
  return response.data;
}

async function createPlanCard(user, planList, placeCard, due, options = {}) {
  const url = "https://api.trello.com/1/cards";
  const values = {
    idList: planList.id,
    name: placeCard.name,
    desc: "",
    due,
    dueComplete: Boolean(options.dueComplete),
  };
  const headers = trelloHeaders(user, url, "POST", values);
  const response = await axios.post(url, null, { params: values, headers });
  const planCard = response.data;
  try {
    await createTrelloCardAttachment(user, planCard.id, placeCard);
  } catch (error) {
    try {
      await updateTrelloCard(user, planCard.id, { closed: true });
    } catch (_cleanupError) {
      // Preserve the attachment error; the orphan is safer archived if cleanup works.
    }
    throw error;
  }
  invalidateBoardCache();
  return planCard;
}

const colorMap = {
  green: "#61bd4f",
  yellow: "#f2d600",
  orange: "#ff9f1a",
  red: "#eb5a46",
  purple: "#c377e0",
  blue: "#0079bf",
  sky: "#00c2e0",
  lime: "#51e898",
  pink: "#ff78cb",
  black: "#344563",
};

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function buildStopPayload(card, listNames, customFields) {
  if (!card) return null;
  const ratingText = getCFTextOrDropdown(card, customFields, "⭐️");
  const ratingNum = ratingText != null ? parseInt(ratingText, 10) : null;
  const labels = (card.labels || []).map((l) => ({
    id: l.id,
    name: l.name,
    color: colorMap[l.color] || "#888",
    trelloColor: l.color,
  }));

  return {
    id: card.id,
    planId: null,
    placeId: card.id,
    name: card.name,
    listName: listNames[card.idList],
    due: card.due,
    lat: getCFNumber(card, customFields, "Latitude"),
    lng: getCFNumber(card, customFields, "Longitude"),
    trelloUrl: card.shortUrl,
    navilyUrl: getCFTextOrDropdown(card, customFields, "Navily"),
    rating: ratingNum,
    desc: card.desc || "",
    labels,
  };
}

function buildPlanningStops(cards, lists, customFields) {
  const listById = new Map(lists.map((list) => [list.id, list]));
  const listNames = Object.fromEntries(
    lists.map((list) => [list.id, list.name]),
  );
  const planList = findPlanList(lists);
  const placeCards = new Map(
    cards
      .filter((card) => !isReservedList(listById.get(card.idList)))
      .map((card) => [card.id, card]),
  );

  const explicit = [];
  const migratedLegacyKeys = new Set();
  if (planList) {
    for (const planCard of cards.filter(
      (card) => card.idList === planList.id,
    )) {
      const placeCard = resolvePlanPlaceCard(planCard, [
        ...placeCards.values(),
      ]);
      if (!placeCard || !planCard.due) continue;
      migratedLegacyKeys.add(
        `${placeCard.id}:${new Date(planCard.due).toISOString()}`,
      );
      explicit.push({
        ...buildStopPayload(placeCard, listNames, customFields),
        id: planCard.id,
        planId: planCard.id,
        placeId: placeCard.id,
        due: planCard.due,
        dueComplete: planCard.dueComplete,
        legacyPlan: false,
        planTrelloUrl: planCard.shortUrl,
      });
    }
  }

  // Temporary compatibility path. Once all old due dates have been migrated,
  // these entries disappear without requiring a flag day for web or iOS users.
  const legacy = [];
  for (const placeCard of placeCards.values()) {
    if (!placeCard.due) continue;
    const legacyKey = `${placeCard.id}:${new Date(placeCard.due).toISOString()}`;
    if (migratedLegacyKeys.has(legacyKey)) continue;
    legacy.push({
      ...buildStopPayload(placeCard, listNames, customFields),
      id: placeCard.id,
      planId: null,
      placeId: placeCard.id,
      due: placeCard.due,
      dueComplete: placeCard.dueComplete,
      legacyPlan: true,
      planTrelloUrl: null,
    });
  }

  return [...explicit, ...legacy].sort(
    (left, right) => new Date(left.due) - new Date(right.due),
  );
}

function resolvePlaceCard(cards, lists, cardId) {
  const card = cards.find((candidate) => candidate.id === cardId);
  if (!card) return null;
  const list = lists.find((candidate) => candidate.id === card.idList);
  if (!isReservedList(list)) return card;
  if (findPlanList(lists)?.id !== card.idList) return null;
  const placeCards = cards.filter((candidate) => {
    const candidateList = lists.find((list) => list.id === candidate.idList);
    return !isReservedList(candidateList);
  });
  return resolvePlanPlaceCard(card, placeCards);
}

function buildVisitStats(comments) {
  const stats = new Map();
  for (const action of comments || []) {
    const text = action?.data?.text;
    const cardId = action?.data?.card?.id;
    if (!cardId || !/^(arrived|visited)\b/i.test(text || "")) continue;
    const timestamp = extractTimestamp(text, action.date, cardId);
    const current = stats.get(cardId) || { visitCount: 0, lastVisitedAt: null };
    current.visitCount += 1;
    if (
      !current.lastVisitedAt ||
      new Date(timestamp) > new Date(current.lastVisitedAt)
    ) {
      current.lastVisitedAt = timestamp;
    }
    stats.set(cardId, current);
  }
  return stats;
}

function parseNavilySnapshot(text) {
  if (!/^navily snapshot\s*$/im.test(String(text || "").split("\n")[0])) {
    return null;
  }
  const values = {};
  for (const line of String(text).split("\n").slice(1)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    values[line.slice(0, separator).trim().toLowerCase()] = line
      .slice(separator + 1)
      .trim();
  }
  const checkedAt = new Date(values["checked-at"] || "");
  const lat = Number(values.lat);
  const lng = Number(values.lng);
  if (!values.source || Number.isNaN(checkedAt.getTime())) return null;
  const splitList = (value) =>
    value
      ? value
          .split(" | ")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
  return {
    checkedAt: checkedAt.toISOString(),
    sourceUrl: values.source,
    name: values.name || null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    summary: values.summary || "",
    characteristics: splitList(values.characteristics),
    seabed: splitList(values.seabed),
    facilities: splitList(values.facilities),
  };
}

function buildNavilySnapshots(comments) {
  const snapshots = new Map();
  for (const action of comments || []) {
    const cardId = action?.data?.card?.id;
    const snapshot = parseNavilySnapshot(action?.data?.text);
    if (!cardId || !snapshot) continue;
    const current = snapshots.get(cardId);
    if (
      !current ||
      new Date(snapshot.checkedAt) > new Date(current.checkedAt)
    ) {
      snapshots.set(cardId, snapshot);
    }
  }
  return snapshots;
}

function cleanSnapshotList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) =>
      String(item || "")
        .replace(/[\r\n|]+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 12)
    .map((item) => item.slice(0, 120));
}

function deriveCurrentStatus(cards, lists, customFields, comments) {
  const listNames = Object.fromEntries(lists.map((l) => [l.id, l.name]));

  const actions = comments
    .filter((a) => a.type === "commentCard" && a.data && a.data.text)
    .map((a) => ({
      ...a,
      ts: extractTimestamp(a.data.text, a.date, a.data.card.id),
    }));

  const lastArrived = actions
    .filter((a) => /^arrived\b/i.test(a.data.text))
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))[0];

  const lastDeparted = actions
    .filter((a) => /^departed\b/i.test(a.data.text))
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))[0];

  const upcomingStops = buildPlanningStops(cards, lists, customFields)
    .filter((stop) => !stop.dueComplete)
    .sort((a, b) => new Date(a.due) - new Date(b.due));
  const plannedDestination = upcomingStops[0] || null;

  let result = { status: "unknown", plannedDestination };

  if (
    lastDeparted &&
    (!lastArrived || new Date(lastDeparted.ts) > new Date(lastArrived.ts))
  ) {
    result.status = "underway";
    result.from = buildStopPayload(
      cards.find((c) => c.id === lastDeparted.data.card.id),
      listNames,
      customFields,
    );
    result.destination = plannedDestination;
    result.departedAt = lastDeparted.ts;
  } else if (lastArrived) {
    result.status = "arrived";
    result.current = buildStopPayload(
      cards.find((c) => c.id === lastArrived.data.card.id),
      listNames,
      customFields,
    );
    result.destination = plannedDestination;
    result.arrivedAt = lastArrived.ts;
    const currentCardId = lastArrived.data.card.id;
    const latestTemperature = actions
      .filter(
        (action) =>
          action.data.card.id === currentCardId &&
          new Date(action.ts) >= new Date(lastArrived.ts) &&
          extractTemperature(action.data.text) !== null,
      )
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))[0];
    result.temperature = latestTemperature
      ? extractTemperature(latestTemperature.data.text)
      : null;
    result.mooring =
      extractMooring(lastArrived.data.text) ||
      result.current?.labels?.find((label) => label.trelloColor === "orange")
        ?.name ||
      null;
    result.visitCount = actions.filter(
      (action) =>
        action.data.card.id === currentCardId &&
        /^(arrived|visited)\b/i.test(action.data.text),
    ).length;
  }

  return result;
}

async function getCurrentStatus() {
  if (currentStopCache && Date.now() < currentStopCacheExpiresAt) {
    return currentStopCache;
  }
  if (currentStopRequest) return currentStopRequest;

  currentStopRequest = (async () => {
    const [{ cards, lists, customFields }, allComments] = await Promise.all([
      fetchBoard(),
      fetchAllComments(),
    ]);
    currentStopCache = deriveCurrentStatus(
      cards,
      lists,
      customFields,
      allComments,
    );
    currentStopCacheExpiresAt = Date.now() + 30_000;
    return currentStopCache;
  })();

  try {
    return await currentStopRequest;
  } finally {
    currentStopRequest = null;
  }
}

function buildLogsFromComments(actions, cards, listNames, customFields) {
  return actions
    .filter((a) => a.type === "commentCard" && a.data && a.data.text)
    .map((a) => {
      const text = a.data.text;
      let type = null;
      let dieselLitres = null;
      let seaTemp = null;
      let item = null;

      if (/^arrived\b/i.test(text)) {
        type = "Arrived";
      } else if (/^departed\b/i.test(text)) {
        type = "Departed";
      } else if (/^visited\b/i.test(text)) {
        type = "Visited";
      } else if (/^water tank change\b/i.test(text)) {
        type = "Water Tank Change";
      } else if (/^water\b/i.test(text)) {
        type = "Water";
      } else {
        const dieselMatch = text.match(
          /^diesel\s*([0-9]+(?:\.[0-9]+)?)\s*(?:litres|liters)?/i,
        );
        const tempMatch = text.match(/^([0-9]+(?:\.[0-9]+)?)\u00B0/);
        const gasChangeMatch = /^gas tank change\b/i.test(text);
        const gasRefillMatch = /^gas tank refill\b/i.test(text);
        const bbqGasMatch = /^bbq gas change\b/i.test(text);
        const otherMatch = text.match(/^other:\s*(.+)$/im);
        const brokenMatch = text.match(/^broken\s+(.+)/i);
        const fixedMatch = text.match(/^fixed\s+(.+)/i);

        if (dieselMatch) {
          type = "Diesel";
          dieselLitres = parseFloat(dieselMatch[1]);
        } else if (tempMatch) {
          type = "Sea Temperature";
          seaTemp = parseFloat(tempMatch[1]);
        } else if (gasChangeMatch) {
          type = "Gas tank change";
        } else if (gasRefillMatch) {
          type = "Gas tank refill";
        } else if (bbqGasMatch) {
          type = "BBQ gas change";
        } else if (otherMatch) {
          type = otherMatch[1].trim();
        } else if (brokenMatch) {
          type = "Broken";
          item = brokenMatch[1]
            .replace(/timestamp:\s*([0-9T:\- ]+)/i, "")
            .trim();
        } else if (fixedMatch) {
          type = "Fixed";
          item = fixedMatch[1]
            .replace(/timestamp:\s*([0-9T:\- ]+)/i, "")
            .trim();
        }
      }

      if (!type) return null;
      const card = cards.find((c) => c.id === a.data.card.id);
      const timestamp = extractTimestamp(text, a.date, a.data.card.id);
      const labels = card
        ? (card.labels || []).map((l) => ({
            id: l.id,
            name: l.name,
            color: colorMap[l.color] || "#888",
          }))
        : [];
      return {
        area: card && card.idList ? listNames[card.idList] : "Unknown",
        cardName: card ? card.name : a.data.card.name || "Unknown",
        type,
        timestamp,
        labels,
        comment: text,
        cardId: a.data.card.id,
        trelloUrl: card ? card.shortUrl : undefined,
        lat: card ? getCFNumber(card, customFields, "Latitude") : null,
        lng: card ? getCFNumber(card, customFields, "Longitude") : null,
        rating: card
          ? (() => {
              const ratingText = getCFTextOrDropdown(card, customFields, "⭐️");
              return ratingText != null ? parseInt(ratingText, 10) : null;
            })()
          : null,
        navilyUrl: card
          ? getCFTextOrDropdown(card, customFields, "Navily")
          : null,
        dieselLitres,
        seaTemp,
        item,
      };
    })
    .filter(Boolean);
}

router.get("/api/closest-locations", async (req, res, next) => {
  try {
    const { lat, latitude, long, lng, longitude, apiKey, token, limit } =
      req.query;

    const latitudeValue = parseFloat(lat ?? latitude);
    const longitudeValue = parseFloat(long ?? lng ?? longitude);

    if (!Number.isFinite(latitudeValue) || !Number.isFinite(longitudeValue)) {
      return res
        .status(400)
        .json({ error: "Missing or invalid latitude/longitude values" });
    }

    if (!apiKey || !token) {
      return res.status(400).json({ error: "Missing apiKey or token" });
    }

    const parsedLimit = parseInt(limit ?? "1", 10);
    const limitValue =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 1;

    const board = await fetchBoardWithCredentials(apiKey, token);
    const { cards, lists, customFields } = board;

    const hasLatitude = customFields.some((field) => field.name === "Latitude");
    const hasLongitude = customFields.some(
      (field) => field.name === "Longitude",
    );

    if (!hasLatitude || !hasLongitude) {
      return res.status(500).json({
        error: "Latitude and Longitude custom fields are required on the board",
      });
    }

    const listNames = Object.fromEntries(
      lists.map((list) => [list.id, list.name]),
    );

    const closestCards = cards
      .map((card) => {
        const cardLat = getCFNumber(card, customFields, "Latitude");
        const cardLng = getCFNumber(card, customFields, "Longitude");

        if (cardLat == null || cardLng == null) {
          return null;
        }

        const distance = calculateDistanceKm(
          latitudeValue,
          longitudeValue,
          cardLat,
          cardLng,
        );

        return {
          card,
          distance,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limitValue)
      .map(({ card }) => ({
        id: card.id,
        name: card.name,
        url: card.shortUrl,
        list: listNames[card.idList],
        desc: card.desc,
      }));

    res.json({ locations: closestCards });
  } catch (error) {
    next(error);
  }
});

router.get("/api/data", async (req, res, next) => {
  try {
    const [board, allComments] = await Promise.all([
      fetchBoard(),
      fetchAllComments(),
    ]);
    const {
      cards,
      lists,
      customFields,
      members,
      labels: boardLabelsRaw,
    } = board;
    const visitStats = buildVisitStats(allComments);
    const navilySnapshots = buildNavilySnapshots(allComments);

    // map of list IDs → names
    const listNames = Object.fromEntries(lists.map((l) => [l.id, l.name]));
    const listById = new Map(lists.map((list) => [list.id, list]));

    const stops = buildPlanningStops(cards, lists, customFields).map(
      (stop) => ({
        ...stop,
        navilySnapshot: navilySnapshots.get(stop.placeId) || null,
        ...(visitStats.get(stop.placeId) || {
          visitCount: 0,
          lastVisitedAt: null,
        }),
      }),
    );

    const places = cards
      .filter(
        (c) =>
          !isReservedList(listById.get(c.idList)) &&
          getCFNumber(c, customFields, "Latitude") != null &&
          getCFNumber(c, customFields, "Longitude") != null,
      )
      .map((c) => {
        const ratingText = getCFTextOrDropdown(c, customFields, "⭐️");
        const labels = (c.labels || []).map((l) => ({
          id: l.id,
          name: l.name,
          color: colorMap[l.color] || "#888",
          trelloColor: l.color,
        }));
        return {
          id: c.id,
          planId: null,
          placeId: c.id,
          name: c.name,
          listName: listNames[c.idList],
          lat: getCFNumber(c, customFields, "Latitude"),
          lng: getCFNumber(c, customFields, "Longitude"),
          rating: ratingText !== null ? parseInt(ratingText, 10) : null,
          trelloUrl: c.shortUrl,
          navilyUrl: getCFTextOrDropdown(c, customFields, "Navily"),
          desc: c.desc,
          labels,
          navilySnapshot: navilySnapshots.get(c.id) || null,
          ...(visitStats.get(c.id) || { visitCount: 0, lastVisitedAt: null }),
        };
      });

    const boardLabels = (boardLabelsRaw || []).map((l) => ({
      id: l.id,
      name: l.name,
      color: colorMap[l.color] || "#888",
      trelloColor: l.color,
    }));

    // Determine if user can plan
    let canPlan = false;
    if (req.user && members) {
      const userId =
        req.user.id ||
        req.user.idMember ||
        (req.user.profile && req.user.profile.id);
      canPlan = members.some(
        (m) =>
          m.id === userId &&
          (m.memberType === "admin" || m.memberType === "normal"),
      );
    }

    res.json({
      stops,
      places,
      canPlan,
      boardLabels,
      placeLists: buildPlaceLists(lists),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/api/location-audit", async (req, res, next) => {
  try {
    const { cards, lists, customFields } = await fetchBoard();
    const listNames = Object.fromEntries(
      lists.map((list) => [list.id, list.name]),
    );
    const locations = cards
      .map((card) => {
        const lat = getCFNumber(card, customFields, "Latitude");
        const lng = getCFNumber(card, customFields, "Longitude");
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const listName = listNames[card.idList] || "Unknown";
        const classification = classifyPlanningPoint({ lat, lng });
        const intentionalLand = listName.toLowerCase() === "land";
        const status = intentionalLand
          ? "intentional-land"
          : !classification.onLand
            ? "water"
            : classification.routable
              ? "nearshore"
              : "review";
        return {
          id: card.id,
          name: card.name,
          listName,
          lat,
          lng,
          trelloUrl: card.shortUrl,
          status,
          distanceToWaterM: classification.distanceToWaterM,
        };
      })
      .filter(Boolean);
    const counts = locations.reduce(
      (result, location) => {
        result[location.status] += 1;
        return result;
      },
      { water: 0, nearshore: 0, review: 0, "intentional-land": 0 },
    );

    res.json({
      total: locations.length,
      counts,
      locations: locations.filter((location) => location.status !== "water"),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/api/logs", async (req, res, next) => {
  try {
    const board = await fetchBoardWithAllComments();
    const { cards, lists, customFields, allComments } = board;
    const listNames = Object.fromEntries(lists.map((l) => [l.id, l.name]));

    // Get trips from cards in the Trips list
    const tripsList = lists.find((l) => l.name === "Trips");
    const trips = cards
      .filter((c) => c.idList === tripsList.id)
      .map((c) => ({
        name: c.name,
        start: c.start,
        due: c.due,
      }))
      .filter((t) => t.start)
      .sort((a, b) => new Date(b.start) - new Date(a.start));

    // Find most recent trip
    const mostRecentTrip = trips[0];

    const logs = buildLogsFromComments(
      allComments,
      cards,
      listNames,
      customFields,
    );

    let filteredLogs = logs;

    // If trip=all, return all logs
    if (req.query.trip === "all") {
      // no filter
    }
    // If start/end are provided, filter by those
    else if (req.query.start) {
      const start = new Date(req.query.start);
      const end = req.query.end ? new Date(req.query.end) : null;
      filteredLogs = logs.filter((l) => {
        const d = new Date(l.timestamp);
        return d >= start && (!end || d <= end);
      });
    }
    // Otherwise, default to most recent trip
    else if (mostRecentTrip) {
      const start = new Date(mostRecentTrip.start);
      const end = mostRecentTrip.due ? new Date(mostRecentTrip.due) : null;
      filteredLogs = logs.filter((l) => {
        const d = new Date(l.timestamp);
        return d >= start && (!end || d <= end);
      });
    }

    // In routes/captainsLog.js, inside router.get('/api/logs', ...)
    const mostRecentTripRange = mostRecentTrip
      ? { start: mostRecentTrip.start, end: mostRecentTrip.due }
      : null;

    res.json({ logs: filteredLogs, mostRecentTripRange });
  } catch (err) {
    next(err);
  }
});

router.get("/api/logs/stream", async (req, res, next) => {
  try {
    const board = await fetchBoard();
    const { cards, lists, customFields } = board;
    const listNames = Object.fromEntries(lists.map((l) => [l.id, l.name]));

    // Get trips from cards in the Trips list
    const tripsList = lists.find((l) => l.name === "Trips");
    const trips = cards
      .filter((c) => c.idList === tripsList.id)
      .map((c) => ({
        name: c.name,
        start: c.start,
        due: c.due,
      }))
      .filter((t) => t.start)
      .sort((a, b) => new Date(b.start) - new Date(a.start));

    const mostRecentTrip = trips[0];
    const mostRecentTripRange = mostRecentTrip
      ? { start: mostRecentTrip.start, end: mostRecentTrip.due }
      : null;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    if (res.flushHeaders) {
      res.flushHeaders();
    }

    let before = null;
    let keepGoing = true;
    let clientClosed = false;
    let sentMeta = false;

    req.on("close", () => {
      clientClosed = true;
    });

    while (keepGoing && !clientClosed) {
      // Return a small recent batch quickly, then continue loading the older
      // history in larger pages while the user can already use the Logbook.
      const { data, done, nextBefore } = await fetchCommentPage({
        before,
        limit: sentMeta ? 1000 : 100,
      });
      const logs = buildLogsFromComments(data, cards, listNames, customFields);
      const payload = { logs };
      if (!sentMeta) {
        payload.mostRecentTripRange = mostRecentTripRange;
        sentMeta = true;
      }
      res.write(`event: batch\ndata: ${JSON.stringify(payload)}\n\n`);
      before = nextBefore;
      keepGoing = !done;
    }

    if (!clientClosed) {
      res.write(`event: done\ndata: {}\n\n`);
      res.end();
    }
  } catch (err) {
    next(err);
  }
});

function handleSeaRoute(req, res, next) {
  try {
    const segments = buildSeaRoute(req.body?.points);
    res.set("Cache-Control", "public, max-age=86400");
    res.json({ segments });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
}

router.post(["/sea-route", "/api/sea-route"], handleSeaRoute);

router.post(["/planning-route", "/api/planning-route"], (req, res, next) => {
  try {
    const route = buildPlanningRoute(req.body?.points);
    res.set("Cache-Control", "public, max-age=86400");
    res.json(route);
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ error: error.message });
    }
    return next(error);
  }
});

// Determine current status and stop based on recent comments
router.get("/api/current-stop", async (req, res, next) => {
  try {
    const result = await getCurrentStatus();
    res.vary("Cookie");
    res.set(
      "Cache-Control",
      req.user ? "private, max-age=30" : "public, max-age=30",
    );
    if (req.user || !result.current) return res.json(result);
    res.json({
      ...result,
      current: { ...result.current, desc: undefined },
    });
  } catch (err) {
    next(err);
  }
});

router.put("/api/current-stop/description", async (req, res, next) => {
  try {
    if (!req.user) return res.status(403).json({ error: "Not authenticated" });

    const description = String(req.body?.description ?? "").replace(
      /\r\n/g,
      "\n",
    );
    if (description.length > 16_384) {
      return res
        .status(400)
        .json({ error: "Description must be 16,384 characters or fewer" });
    }

    const status = await getCurrentStatus();
    if (status.status !== "arrived" || !status.current?.id) {
      return res
        .status(409)
        .json({ error: "There is no current stop to update" });
    }

    const url = `https://api.trello.com/1/cards/${status.current.id}`;
    const oauth1a = require("oauth-1.0a");
    const crypto = require("crypto");
    const oauthClient = oauth1a({
      consumer: {
        key: process.env.TRELLO_OAUTH_KEY,
        secret: process.env.TRELLO_OAUTH_SECRET,
      },
      signature_method: "HMAC-SHA1",
      hash_function(baseString, key) {
        return crypto
          .createHmac("sha1", key)
          .update(baseString)
          .digest("base64");
      },
    });
    const requestData = { url, method: "PUT", data: { desc: description } };
    const headers = oauthClient.toHeader(
      oauthClient.authorize(requestData, {
        key: req.user.token,
        secret: req.user.tokenSecret,
      }),
    );

    await axios.put(url, null, { params: { desc: description }, headers });
    invalidateBoardCache();
    if (currentStopCache?.current?.id === status.current.id) {
      currentStopCache.current.desc = description;
    }
    res.json({ success: true, description });
  } catch (error) {
    next(error);
  }
});

router.get("/api/voyages", async (req, res, next) => {
  try {
    const { cards, lists } = await fetchBoard();
    const tripsList = lists.find((list) => list.name === "Trips");
    const voyages = tripsList
      ? cards
          .filter((card) => card.idList === tripsList.id)
          .map((card) => ({
            id: card.id,
            name: card.name,
            start: card.start,
            end: card.due,
            desc: card.desc || "",
          }))
          .filter((voyage) => voyage.start || voyage.end)
          .sort(
            (a, b) => new Date(b.start || b.end) - new Date(a.start || a.end),
          )
      : [];
    res.set("Cache-Control", "public, max-age=60");
    res.json({ voyages });
  } catch (error) {
    next(error);
  }
});

router.post("/api/log-context", async (req, res, next) => {
  try {
    const { lat, latitude, long, lng, longitude, speedKts, limit } =
      req.body || {};

    const latitudeValue = parseFloat(lat ?? latitude);
    const longitudeValue = parseFloat(long ?? lng ?? longitude);

    if (!Number.isFinite(latitudeValue) || !Number.isFinite(longitudeValue)) {
      return res
        .status(400)
        .json({ error: "Missing or invalid latitude/longitude values" });
    }

    const parsedLimit = parseInt(limit ?? "5", 10);
    const limitValue =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 5;

    const { cards, lists, customFields } = await fetchBoard();
    const comments = await fetchRecentComments(100);
    const currentStop = deriveCurrentStatus(
      cards,
      lists,
      customFields,
      comments,
    );
    const tripsList = lists.find((l) => l.name === "Trips");
    const tripsListId = tripsList ? tripsList.id : null;
    const listNames = Object.fromEntries(
      lists.map((list) => [list.id, list.name]),
    );

    const suggestions = cards
      .filter((card) => card.idList !== tripsListId)
      .map((card) => {
        const cardLat = getCFNumber(card, customFields, "Latitude");
        const cardLng = getCFNumber(card, customFields, "Longitude");
        if (cardLat == null || cardLng == null) return null;

        return {
          id: card.id,
          name: card.name,
          list: listNames[card.idList],
          distanceKm: calculateDistanceKm(
            latitudeValue,
            longitudeValue,
            cardLat,
            cardLng,
          ),
          lat: cardLat,
          lng: cardLng,
          trelloUrl: card.shortUrl,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, limitValue);

    const hasSpeed = Number.isFinite(parseFloat(speedKts));
    const speedKnots = hasSpeed ? parseFloat(speedKts) : null;
    const mode =
      currentStop.status === "underway" ||
      (speedKnots != null && speedKnots > 1.5)
        ? "underway"
        : "port";

    const fallbackCardId =
      mode === "underway"
        ? currentStop.from?.id ||
          currentStop.destination?.placeId ||
          suggestions[0]?.id ||
          null
        : currentStop.current?.id || suggestions[0]?.id || null;

    const action = mode === "underway" ? "departed" : "arrived";

    res.json({
      mode,
      status: {
        current: currentStop.status,
        departedAt: currentStop.departedAt || null,
      },
      suggestions,
      draft: {
        action,
        cardId: fallbackCardId,
        lat: latitudeValue,
        lng: longitudeValue,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/api/log-entry", async (req, res, next) => {
  try {
    if (!req.user) return res.status(403).json({ error: "Not authenticated" });

    const {
      action,
      cardId: requestedCardId,
      lat,
      latitude,
      long,
      lng,
      longitude,
      timestamp,
      source,
      litres,
      temperature,
      journeyName,
      placeName,
      customText,
      mooringLabelId,
      planId: requestedPlanId,
    } = req.body || {};
    let cardId = requestedCardId;
    let planId = requestedPlanId;

    const normalizedAction = String(action || "")
      .trim()
      .toLowerCase();
    const allowedActions = [
      "arrived",
      "departed",
      "visited",
      "water",
      "diesel",
      "temperature",
      "bins",
      "bbq-gas-change",
      "gas-tank-change",
      "water-tank-change",
      "power",
      "boom",
      "other",
    ];
    if (!allowedActions.includes(normalizedAction)) {
      return res.status(400).json({ error: "Invalid action" });
    }

    if (!cardId) {
      return res.status(400).json({ error: "Missing cardId" });
    }

    const latitudeValue = parseFloat(lat ?? latitude);
    const longitudeValue = parseFloat(long ?? lng ?? longitude);
    if (!Number.isFinite(latitudeValue) || !Number.isFinite(longitudeValue)) {
      return res
        .status(400)
        .json({ error: "Missing or invalid latitude/longitude values" });
    }

    const ts = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(ts.getTime())) {
      return res.status(400).json({ error: "Invalid timestamp" });
    }

    const suppliedJourneyName = String(journeyName || "").trim();
    const suppliedPlaceName = String(placeName || "").trim();
    const suppliedCustomText = String(customText || "")
      .replace(/\s+/g, " ")
      .trim();
    if (suppliedJourneyName.length > 160) {
      return res.status(400).json({ error: "Journey name is too long" });
    }
    if (normalizedAction === "other" && !suppliedCustomText) {
      return res.status(400).json({ error: "Please describe what happened" });
    }
    if (suppliedCustomText.length > 160) {
      return res.status(400).json({ error: "Custom log text is too long" });
    }

    let mooringLabel = null;
    let destinationCard = null;
    let board = null;
    if (
      ["arrived", "visited", "departed"].includes(normalizedAction) ||
      mooringLabelId
    ) {
      board = await fetchBoard();
      const requestedCard = (board.cards || []).find(
        (card) => card.id === cardId,
      );
      if (
        requestedCard &&
        requestedCard?.idList === findPlanList(board.lists)?.id
      ) {
        const requestedPlace = resolvePlaceCard(
          board.cards,
          board.lists,
          requestedCard.id,
        );
        if (!requestedPlace) {
          return res.status(400).json({ error: "Plan card is not linked" });
        }
        planId ||= requestedCard.id;
        cardId = requestedPlace.id;
      }
      destinationCard = resolvePlaceCard(board.cards, board.lists, cardId);
      if (!destinationCard) {
        return res.status(400).json({ error: "Location card was not found" });
      }
    }
    if (normalizedAction === "arrived" && mooringLabelId) {
      mooringLabel = (board.labels || []).find(
        (label) => label.id === mooringLabelId && label.color === "orange",
      );
      if (!mooringLabel) {
        return res.status(400).json({ error: "Invalid mooring type" });
      }
    }

    const actionLabels = {
      arrived: "Arrived",
      departed: "Departed",
      visited: "Visited",
      water: "Water",
      diesel: "Diesel",
      temperature: "Sea Temp",
      bins: "Bins",
      "bbq-gas-change": "BBQ Gas Change",
      "gas-tank-change": "Gas Tank Change",
      "water-tank-change": "Water Tank Change",
      power: "Power",
      boom: "Boom",
      other: "Other",
    };

    const litresValue = parseFloat(litres);
    const hasLitres =
      ["water", "diesel"].includes(normalizedAction) &&
      Number.isFinite(litresValue) &&
      litresValue >= 0;
    const temperatureValue = Number(temperature);
    const temperatureWasSupplied =
      temperature !== null && temperature !== undefined && temperature !== "";
    const supportsTemperature = ["arrived", "temperature"].includes(
      normalizedAction,
    );
    const hasTemperature =
      supportsTemperature &&
      temperatureWasSupplied &&
      Number.isFinite(temperatureValue);
    if (normalizedAction === "temperature" && !hasTemperature) {
      return res.status(400).json({ error: "Missing or invalid temperature" });
    }
    if (
      normalizedAction === "arrived" &&
      temperatureWasSupplied &&
      !hasTemperature
    ) {
      return res.status(400).json({ error: "Invalid temperature" });
    }

    const headline =
      normalizedAction === "other"
        ? `Other: ${suppliedCustomText}`
        : normalizedAction === "temperature" && hasTemperature
          ? `${temperatureValue}°`
          : hasLitres
            ? `${actionLabels[normalizedAction]} ${litresValue} litres`
            : actionLabels[normalizedAction];

    const commentLines = [
      headline,
      `timestamp: ${ts.toISOString()}`,
      `lat: ${latitudeValue}`,
      `lng: ${longitudeValue}`,
    ];

    if (source) {
      commentLines.push(`source: ${String(source).trim()}`);
    }
    if (mooringLabel) {
      commentLines.push(`mooring: ${mooringLabel.name}`);
    }
    if (hasTemperature && normalizedAction === "arrived") {
      commentLines.push(`temperature: ${temperatureValue}`);
    }

    const text = commentLines.join("\n");

    const journeyChange = {
      ended: false,
      started: false,
      journey: null,
    };
    if (["arrived", "departed"].includes(normalizedAction)) {
      const activeJourney = findActiveJourney(await fetchJourneyCards());
      const memberId =
        req.user.id || req.user.idMember || req.user.profile?.id || null;

      if (normalizedAction === "arrived" && activeJourney) {
        if (ts < new Date(activeJourney.metadata.startedAt)) {
          return res
            .status(400)
            .json({ error: "Arrival time predates the active journey" });
        }
        await endJourney(req.user, activeJourney.card, {
          endedAt: ts.toISOString(),
          endedBy: memberId || "unknown",
        });
        journeyChange.ended = true;
        journeyChange.journey = {
          id: activeJourney.card.id,
          name: activeJourney.card.name,
        };
      }

      if (normalizedAction === "departed") {
        if (activeJourney) {
          journeyChange.journey = {
            id: activeJourney.card.id,
            name: activeJourney.card.name,
          };
        } else {
          if (!memberId) {
            return res.status(400).json({ error: "Missing Trello member ID" });
          }
          const newJourney = await createJourney(req.user, {
            name:
              suppliedJourneyName ||
              (suppliedPlaceName ? `Journey from ${suppliedPlaceName}` : ""),
            startedAt: ts.toISOString(),
            startedBy: memberId,
          });
          journeyChange.started = true;
          journeyChange.journey = {
            id: newJourney.id,
            name: newJourney.name,
          };
        }
      }
    }

    const oauth = {
      consumer_key: process.env.TRELLO_OAUTH_KEY,
      consumer_secret: process.env.TRELLO_OAUTH_SECRET,
      token: req.user.token,
      token_secret: req.user.tokenSecret,
    };

    const oauth1a = require("oauth-1.0a");
    const crypto = require("crypto");

    const oauthClient = oauth1a({
      consumer: { key: oauth.consumer_key, secret: oauth.consumer_secret },
      signature_method: "HMAC-SHA1",
      hash_function(base_string, key) {
        return crypto
          .createHmac("sha1", key)
          .update(base_string)
          .digest("base64");
      },
    });

    const url = `https://api.trello.com/1/cards/${cardId}/actions/comments`;
    const request_data = { url, method: "POST", data: { text } };
    const headers = oauthClient.toHeader(
      oauthClient.authorize(request_data, {
        key: oauth.token,
        secret: oauth.token_secret,
      }),
    );

    const completesPlannedStop = ["arrived", "visited"].includes(
      normalizedAction,
    );
    const plansForPlace = board
      ? buildPlanningStops(board.cards, board.lists, board.customFields).filter(
          (stop) => stop.placeId === cardId,
        )
      : [];
    const outstandingPlans = plansForPlace
      .filter((stop) => !stop.dueComplete)
      .sort((left, right) => new Date(left.due) - new Date(right.due));
    const completedPlans = plansForPlace
      .filter((stop) => stop.dueComplete && !stop.legacyPlan)
      .sort((left, right) => new Date(right.due) - new Date(left.due));
    const planToComplete = planId
      ? outstandingPlans.find((stop) => stop.id === planId)
      : outstandingPlans[0];
    const planToArchive =
      normalizedAction === "departed"
        ? planId
          ? completedPlans.find((stop) => stop.id === planId)
          : completedPlans[0]
        : null;
    if (planId && completesPlannedStop && !planToComplete) {
      return res
        .status(400)
        .json({ error: "The selected planned visit was not found" });
    }
    if (planId && normalizedAction === "departed" && !planToArchive) {
      return res
        .status(400)
        .json({ error: "The completed planned visit was not found" });
    }
    const legacyPlan = planToComplete?.legacyPlan ? planToComplete : null;
    const completedPlanId =
      completesPlannedStop && planToComplete ? planToComplete.planId : null;
    const archivedPlanId = planToArchive?.planId || null;
    const clearsPlannedStopDueDate =
      normalizedAction === "departed" && Boolean(legacyPlan);
    const updatePlanOccurrence = async () => {
      if (completesPlannedStop && planToComplete) {
        await updateTrelloCard(req.user, planToComplete.id, {
          dueComplete: true,
        });
      } else if (planToArchive) {
        await updateTrelloCard(req.user, planToArchive.id, { closed: true });
      }
    };

    const clearLegacyPlanDueDate = async () => {
      if (!clearsPlannedStopDueDate) return;
      await updateTrelloCard(req.user, legacyPlan.id, {
        due: "null",
        dueComplete: false,
      });
    };

    const addMooringLabel = async () => {
      if (
        !mooringLabel ||
        (destinationCard.labels || []).some(
          (label) => label.id === mooringLabel.id,
        )
      ) {
        return false;
      }

      const labelUrl = `https://api.trello.com/1/cards/${cardId}/idLabels`;
      const labelRequest = {
        url: labelUrl,
        method: "POST",
        data: { value: mooringLabel.id },
      };
      const labelHeaders = oauthClient.toHeader(
        oauthClient.authorize(labelRequest, {
          key: oauth.token,
          secret: oauth.token_secret,
        }),
      );
      await axios.post(labelUrl, null, {
        params: { value: mooringLabel.id },
        headers: labelHeaders,
      });
      invalidateBoardCache();
      return true;
    };

    if (clearsPlannedStopDueDate) await clearLegacyPlanDueDate();

    await axios.post(url, null, {
      params: { text },
      headers,
    });
    invalidateCommentCache();

    const mooringLabelAdded = await addMooringLabel();

    if (completesPlannedStop || planToArchive) await updatePlanOccurrence();

    currentStopCache = null;
    currentStopCacheExpiresAt = 0;

    res.json({
      success: true,
      comment: text,
      dueComplete: completesPlannedStop && Boolean(planToComplete),
      dueCleared: clearsPlannedStopDueDate,
      completedPlanId,
      planArchived: Boolean(archivedPlanId),
      archivedPlanId,
      legacyPlanUpdated: Boolean(legacyPlan),
      mooringLabelAdded,
      journey: journeyChange,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/api/log-notification", async (req, res, next) => {
  try {
    if (!req.user) return res.status(403).json({ error: "Not authenticated" });

    const {
      mode,
      requestId,
      action,
      cardId,
      lat,
      lng,
      timestamp,
      litres,
      temperature,
      customText,
    } = req.body || {};

    if (!["people", "test"].includes(mode)) {
      return res.status(400).json({ error: "Invalid notification option" });
    }
    if (!ACTION_LABELS[action]) {
      return res.status(400).json({ error: "Invalid action" });
    }
    const suppliedCustomText = String(customText || "")
      .replace(/\s+/g, " ")
      .trim();
    if (action === "other" && !suppliedCustomText) {
      return res.status(400).json({ error: "Please describe what happened" });
    }
    if (suppliedCustomText.length > 160) {
      return res.status(400).json({ error: "Custom log text is too long" });
    }
    const suppliedTemperature = Number(temperature);
    const temperatureWasSupplied =
      temperature !== null && temperature !== undefined && temperature !== "";
    if (
      action === "temperature" &&
      (!temperatureWasSupplied || !Number.isFinite(suppliedTemperature))
    ) {
      return res.status(400).json({ error: "Missing or invalid temperature" });
    }
    if (
      action === "arrived" &&
      temperatureWasSupplied &&
      !Number.isFinite(suppliedTemperature)
    ) {
      return res.status(400).json({ error: "Invalid temperature" });
    }
    if (!cardId) {
      return res.status(400).json({ error: "Missing cardId" });
    }
    if (
      typeof requestId !== "string" ||
      requestId.length < 8 ||
      requestId.length > 120 ||
      !/^[a-zA-Z0-9_-]+$/.test(requestId)
    ) {
      return res.status(400).json({ error: "Invalid notification request ID" });
    }

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentNotifications = Array.isArray(
      req.session.logNotificationTimestamps,
    )
      ? req.session.logNotificationTimestamps.filter(
          (sentAt) => Number(sentAt) > oneHourAgo,
        )
      : [];
    if (recentNotifications.length >= 10) {
      return res
        .status(429)
        .json({ error: "Too many email notifications. Try again later." });
    }
    req.session.logNotificationTimestamps = [
      ...recentNotifications,
      Date.now(),
    ];

    const latitude = Number(lat);
    const longitude = Number(lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: "Invalid notification position" });
    }

    const loggedAt = new Date(timestamp);
    if (Number.isNaN(loggedAt.getTime())) {
      return res.status(400).json({ error: "Invalid notification timestamp" });
    }

    const { cards, lists, members } = await fetchBoard();
    const userId =
      req.user.id ||
      req.user.idMember ||
      (req.user.profile && req.user.profile.id);
    const canNotify = (members || []).some(
      (member) =>
        member.id === userId &&
        (member.memberType === "admin" || member.memberType === "normal"),
    );
    if (!canNotify) {
      return res
        .status(403)
        .json({ error: "Not authorized to send notifications" });
    }

    const card = resolvePlaceCard(cards, lists, cardId);
    if (!card) {
      return res.status(404).json({ error: "Location not found" });
    }

    const litresValue = Number(litres);
    const result = await sendLogNotification({
      mode,
      idempotencyKey: `log-notification/${requestId}`,
      action,
      location: card.name,
      lat: latitude,
      lng: longitude,
      timestamp: loggedAt.toISOString(),
      customText: suppliedCustomText || null,
      litres:
        ["water", "diesel"].includes(action) && Number.isFinite(litresValue)
          ? litresValue
          : null,
      temperature:
        ["arrived", "temperature"].includes(action) &&
        temperatureWasSupplied &&
        Number.isFinite(suppliedTemperature)
          ? suppliedTemperature
          : null,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    next(error);
  }
});

router.get("/", (req, res) => {
  // Keep the initial HTML independent of Trello so the page shell can render
  // immediately. Chart, logbook, and voyage data are filled in asynchronously.
  res.render("captains-log", { user: req.user, activePage: "planning" });
});

router.get("/logbook", (req, res) => {
  res.render("captains-log", { user: req.user, activePage: "log" });
});

// Preserve old bookmarks while making the chart available at the site root.
router.get("/captains-log", (req, res) => {
  res.redirect(301, "/");
});

router.get("/plan-migration", (req, res) => {
  if (!req.user) {
    return res.redirect("/auth/trello");
  }
  res.render("plan-migration", { user: req.user });
});

router.post("/api/places", async (req, res, next) => {
  try {
    if (!req.user) return res.status(403).json({ error: "Not authenticated" });

    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").replace(
      /\r\n/g,
      "\n",
    );
    const listId = String(req.body?.listId || "").trim();
    const navilyUrl = normalizeNavilyUrl(req.body?.navilyUrl);
    const hasLatitude =
      req.body?.lat !== null &&
      req.body?.lat !== undefined &&
      req.body?.lat !== "";
    const hasLongitude =
      req.body?.lng !== null &&
      req.body?.lng !== undefined &&
      req.body?.lng !== "";
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);

    if (!name) return res.status(400).json({ error: "Missing place name" });
    if (name.length > 256) {
      return res
        .status(400)
        .json({ error: "Place name must be 256 characters or fewer" });
    }
    if (description.length > 16_384) {
      return res
        .status(400)
        .json({ error: "Description must be 16,384 characters or fewer" });
    }
    if (!listId) return res.status(400).json({ error: "Missing listId" });
    if (!navilyUrl) {
      return res.status(400).json({ error: "Enter a valid Navily place URL" });
    }
    if (!hasLatitude || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      return res
        .status(400)
        .json({ error: "Latitude must be between -90 and 90" });
    }
    if (!hasLongitude || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return res
        .status(400)
        .json({ error: "Longitude must be between -180 and 180" });
    }

    const board = await fetchBoard();
    const { cards, customFields, lists, members } = board;
    if (!isBoardMember(req.user, members)) {
      return res.status(403).json({ error: "Not a board member" });
    }

    const availableLists = buildPlaceLists(lists);
    const destinationList = availableLists.find((list) => list.id === listId);
    if (!destinationList) {
      return res.status(400).json({ error: "Select a valid place list" });
    }

    const latitudeField = customFields.find(
      (field) => field.name === "Latitude",
    );
    const longitudeField = customFields.find(
      (field) => field.name === "Longitude",
    );
    const navilyField = customFields.find((field) => field.name === "Navily");
    if (!latitudeField || !longitudeField || !navilyField) {
      return res.status(500).json({
        error: "Latitude, Longitude, and Navily custom fields are required",
      });
    }

    const duplicate = cards.find(
      (card) =>
        normalizeNavilyUrl(
          getCFTextOrDropdown(card, customFields, "Navily"),
        ) === navilyUrl,
    );
    if (duplicate) {
      return res.status(409).json({
        error: `This Navily place is already saved as ${duplicate.name}`,
      });
    }

    const oauth1a = require("oauth-1.0a");
    const crypto = require("crypto");
    const oauthClient = oauth1a({
      consumer: {
        key: process.env.TRELLO_OAUTH_KEY,
        secret: process.env.TRELLO_OAUTH_SECRET,
      },
      signature_method: "HMAC-SHA1",
      hash_function(baseString, key) {
        return crypto
          .createHmac("sha1", key)
          .update(baseString)
          .digest("base64");
      },
    });
    const oauthToken = {
      key: req.user.token,
      secret: req.user.tokenSecret,
    };
    const signedHeaders = (url, method, data) =>
      oauthClient.toHeader(
        oauthClient.authorize({ url, method, data }, oauthToken),
      );

    const createUrl = "https://api.trello.com/1/cards";
    const createParams = { name, desc: description, idList: listId };
    const { data: card } = await axios.post(createUrl, null, {
      params: createParams,
      headers: signedHeaders(createUrl, "POST", createParams),
    });

    const customFieldUpdates = [
      [latitudeField, { value: { number: String(lat) } }],
      [longitudeField, { value: { number: String(lng) } }],
      [navilyField, { value: { text: navilyUrl } }],
    ];
    for (const [field, payload] of customFieldUpdates) {
      const url = `https://api.trello.com/1/cards/${card.id}/customField/${field.id}/item`;
      await axios.put(url, payload, {
        headers: signedHeaders(url, "PUT", payload),
      });
    }

    invalidateBoardCache();
    res.status(201).json({
      success: true,
      place: {
        id: card.id,
        planId: null,
        placeId: card.id,
        name,
        listName: destinationList.name,
        due: null,
        dueComplete: false,
        lat,
        lng,
        rating: null,
        desc: description,
        labels: [],
        trelloUrl: card.shortUrl || null,
        navilyUrl,
        visitCount: 0,
        lastVisitedAt: null,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/api/places/:cardId/navily-snapshots", async (req, res, next) => {
  try {
    if (!req.user) return res.status(403).json({ error: "Not authenticated" });

    const board = await fetchBoard();
    const { cards, lists, customFields, members } = board;
    if (!isBoardMember(req.user, members)) {
      return res.status(403).json({ error: "Not a board member" });
    }
    const card = resolvePlaceCard(cards, lists, req.params.cardId);
    if (!card) return res.status(404).json({ error: "Place not found" });

    const savedUrl = normalizeNavilyUrl(
      getCFTextOrDropdown(card, customFields, "Navily"),
    );
    const sourceUrl = normalizeNavilyUrl(req.body?.sourceUrl);
    if (!savedUrl || !sourceUrl || savedUrl !== sourceUrl) {
      return res
        .status(400)
        .json({ error: "Snapshot URL does not match this place" });
    }

    const name = String(req.body?.name || "")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, 256);
    const summary = String(req.body?.summary || "")
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, 2_000);
    const characteristics = cleanSnapshotList(req.body?.characteristics);
    const seabed = cleanSnapshotList(req.body?.seabed);
    const facilities = cleanSnapshotList(req.body?.facilities);
    const hasLatitude = req.body?.lat !== null && req.body?.lat !== undefined;
    const hasLongitude = req.body?.lng !== null && req.body?.lng !== undefined;
    const lat = hasLatitude ? Number(req.body.lat) : null;
    const lng = hasLongitude ? Number(req.body.lng) : null;
    if (
      hasLatitude !== hasLongitude ||
      (hasLatitude && (!Number.isFinite(lat) || lat < -90 || lat > 90)) ||
      (hasLongitude && (!Number.isFinite(lng) || lng < -180 || lng > 180))
    ) {
      return res.status(400).json({ error: "Invalid snapshot coordinates" });
    }
    if (
      !summary &&
      characteristics.length === 0 &&
      seabed.length === 0 &&
      facilities.length === 0
    ) {
      return res
        .status(400)
        .json({ error: "Snapshot contains no place details" });
    }

    const checkedAt = new Date().toISOString();
    const commentLines = [
      "navily snapshot",
      "version: 1",
      `checked-at: ${checkedAt}`,
      `source: ${sourceUrl}`,
    ];
    if (name) commentLines.push(`name: ${name}`);
    if (lat != null && lng != null) {
      commentLines.push(`lat: ${lat}`, `lng: ${lng}`);
    }
    if (summary) commentLines.push(`summary: ${summary}`);
    if (characteristics.length) {
      commentLines.push(`characteristics: ${characteristics.join(" | ")}`);
    }
    if (seabed.length) commentLines.push(`seabed: ${seabed.join(" | ")}`);
    if (facilities.length) {
      commentLines.push(`facilities: ${facilities.join(" | ")}`);
    }
    const text = commentLines.join("\n");

    const oauth1a = require("oauth-1.0a");
    const crypto = require("crypto");
    const oauthClient = oauth1a({
      consumer: {
        key: process.env.TRELLO_OAUTH_KEY,
        secret: process.env.TRELLO_OAUTH_SECRET,
      },
      signature_method: "HMAC-SHA1",
      hash_function(baseString, key) {
        return crypto
          .createHmac("sha1", key)
          .update(baseString)
          .digest("base64");
      },
    });
    const url = `https://api.trello.com/1/cards/${card.id}/actions/comments`;
    const requestData = { url, method: "POST", data: { text } };
    const headers = oauthClient.toHeader(
      oauthClient.authorize(requestData, {
        key: req.user.token,
        secret: req.user.tokenSecret,
      }),
    );
    await axios.post(url, null, { params: { text }, headers });
    invalidateBoardCache();
    invalidateCommentCache();

    res.status(201).json({
      success: true,
      snapshot: {
        checkedAt,
        sourceUrl,
        name: name || null,
        lat,
        lng,
        summary,
        characteristics,
        seabed,
        facilities,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/api/plan-stop", async (req, res, next) => {
  try {
    if (!req.user) return res.status(403).json({ error: "Not authenticated" });
    const { cards, lists, members } = await fetchBoard();
    if (!isBoardMember(req.user, members)) {
      return res.status(403).json({ error: "Board membership is required" });
    }

    const planList = findPlanList(lists);
    if (!planList) {
      return res
        .status(409)
        .json({ error: 'The Trello list "Plan" was not found' });
    }

    const due = new Date(req.body?.due);
    if (Number.isNaN(due.getTime())) {
      return res.status(400).json({ error: "Invalid due date" });
    }

    const suppliedPlanId = req.body?.planId || null;
    const suppliedPlaceId = req.body?.placeId || req.body?.cardId || null;
    let planCard = suppliedPlanId
      ? cards.find((card) => card.id === suppliedPlanId)
      : null;

    // Backwards compatibility for an older client passing the plan card as
    // cardId when editing an already-created occurrence.
    if (!planCard && suppliedPlaceId) {
      const candidate = cards.find((card) => card.id === suppliedPlaceId);
      if (
        candidate?.idList === planList.id &&
        resolvePlaceCard(cards, lists, candidate.id)
      ) {
        planCard = candidate;
      }
    }

    if (planCard) {
      const linkedPlace = resolvePlaceCard(cards, lists, planCard.id);
      if (planCard.idList !== planList.id || !linkedPlace) {
        return res.status(400).json({ error: "Invalid plan card" });
      }
      if (
        suppliedPlaceId &&
        suppliedPlanId &&
        suppliedPlaceId !== linkedPlace.id
      ) {
        return res
          .status(400)
          .json({ error: "Plan card does not match this location" });
      }
      await updateTrelloCard(req.user, planCard.id, {
        due: due.toISOString(),
        dueComplete: false,
      });
      return res.json({
        success: true,
        id: planCard.id,
        planId: planCard.id,
        placeId: linkedPlace.id,
      });
    }

    const placeCard = cards.find((card) => card.id === suppliedPlaceId);
    const placeList = lists.find((list) => list.id === placeCard?.idList);
    if (!placeCard || isReservedList(placeList)) {
      return res.status(404).json({ error: "Location card was not found" });
    }

    const created = await createPlanCard(
      req.user,
      planList,
      placeCard,
      due.toISOString(),
    );
    res.status(201).json({
      success: true,
      id: created.id,
      planId: created.id,
      placeId: placeCard.id,
    });
  } catch (err) {
    console.log("Error in /api/plan-stop:", err);
    next(err);
  }
});

router.post("/api/remove-stop", async (req, res, next) => {
  try {
    if (!req.user) return res.status(403).json({ error: "Not authenticated" });

    const planId = req.body?.planId || req.body?.cardId;
    if (!planId) return res.status(400).json({ error: "Missing planId" });

    const { cards, lists, members } = await fetchBoard();
    if (!isBoardMember(req.user, members)) {
      return res.status(403).json({ error: "Board membership is required" });
    }
    const planList = findPlanList(lists);
    const card = cards.find((candidate) => candidate.id === planId);
    if (!card)
      return res.status(404).json({ error: "Planned stop was not found" });

    if (
      planList &&
      card.idList === planList.id &&
      resolvePlaceCard(cards, lists, card.id)
    ) {
      await updateTrelloCard(req.user, card.id, { closed: true });
      return res.json({ success: true, planId: card.id, archived: true });
    }

    // Temporary fallback for a legacy place card that still carries its due date.
    const cardList = lists.find((list) => list.id === card.idList);
    if (isReservedList(cardList) || !card.due) {
      return res.status(400).json({ error: "Invalid legacy planned stop" });
    }
    await updateTrelloCard(req.user, card.id, {
      due: "null",
      dueComplete: false,
    });
    res.json({ success: true, planId: null, placeId: card.id, legacy: true });
  } catch (err) {
    console.log("Error in /api/remove-stop:", err);
    next(err);
  }
});

router.post("/api/reorder-stops", async (req, res, next) => {
  try {
    if (!req.user) return res.status(403).json({ error: "Not authenticated" });
    const { updates } = req.body;
    if (!Array.isArray(updates))
      return res.status(400).json({ error: "Invalid updates" });
    const { cards, lists, members } = await fetchBoard();
    if (!isBoardMember(req.user, members)) {
      return res.status(403).json({ error: "Board membership is required" });
    }
    const cardsById = new Map(cards.map((card) => [card.id, card]));
    const listById = new Map(lists.map((list) => [list.id, list]));
    const planList = findPlanList(lists);
    const normalized = updates.map((update) => ({
      planId: update.planId || update.cardId,
      due: new Date(update.due),
    }));
    if (
      normalized.some(
        (update) =>
          !update.planId ||
          Number.isNaN(update.due.getTime()) ||
          !cardsById.has(update.planId),
      )
    ) {
      return res.status(400).json({ error: "Invalid plan update" });
    }
    const hasInvalidTarget = normalized.some((update) => {
      const card = cardsById.get(update.planId);
      const isPlanCard =
        planList &&
        card.idList === planList.id &&
        Boolean(resolvePlaceCard(cards, lists, card.id));
      const isLegacyPlace =
        !isReservedList(listById.get(card.idList)) && Boolean(card.due);
      return !isPlanCard && !isLegacyPlace;
    });
    if (hasInvalidTarget) {
      return res.status(400).json({ error: "Invalid planned stop" });
    }

    for (const update of normalized) {
      await updateTrelloCard(req.user, update.planId, {
        due: update.due.toISOString(),
      });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post("/api/plan/migrate", async (req, res, next) => {
  try {
    if (!req.user) return res.status(403).json({ error: "Not authenticated" });
    const { cards, lists, members, customFields } = await fetchBoard();
    if (!isBoardMember(req.user, members)) {
      return res.status(403).json({ error: "Board membership is required" });
    }
    const planList = findPlanList(lists);
    if (!planList) {
      return res
        .status(409)
        .json({ error: 'The Trello list "Plan" was not found' });
    }

    const listById = new Map(lists.map((list) => [list.id, list]));
    const placeCards = cards.filter(
      (card) => !isReservedList(listById.get(card.idList)),
    );
    const placeCardsById = new Map(placeCards.map((card) => [card.id, card]));
    const planCards = cards.filter((card) => card.idList === planList.id);

    // Convert the first-generation metadata Plan cards to native Trello card
    // attachments before clearing the old metadata from their descriptions.
    const linked = [];
    for (const planCard of planCards) {
      const metadata = parseLegacyPlanMetadata(planCard.desc);
      if (!metadata) continue;
      const placeCard = placeCardsById.get(metadata.placeCardId);
      if (!placeCard) continue;
      if (!findAttachedPlaceCard(planCard, placeCards)) {
        await createTrelloCardAttachment(req.user, planCard.id, placeCard);
        planCard.attachments = [
          ...(planCard.attachments || []),
          { name: placeCard.name, url: placeCard.shortUrl, isUpload: false },
        ];
      }
      await updateTrelloCard(req.user, planCard.id, {
        desc: removeLegacyPlanMetadata(planCard.desc),
      });
      linked.push({ planId: planCard.id, placeId: placeCard.id });
    }

    const existingPlanKeys = new Set(
      planCards.flatMap((planCard) => {
        if (!planCard.due) return [];
        const placeCard = resolvePlanPlaceCard(planCard, placeCards);
        return placeCard
          ? [`${placeCard.id}:${new Date(planCard.due).toISOString()}`]
          : [];
      }),
    );
    const legacyCards = cards.filter(
      (card) =>
        card.due &&
        !isReservedList(listById.get(card.idList)) &&
        getCFNumber(card, customFields, "Latitude") != null &&
        getCFNumber(card, customFields, "Longitude") != null,
    );

    const results = [];
    for (const placeCard of legacyCards) {
      const due = new Date(placeCard.due).toISOString();
      const key = `${placeCard.id}:${due}`;
      let created = null;
      if (!existingPlanKeys.has(key)) {
        created = await createPlanCard(req.user, planList, placeCard, due, {
          dueComplete: placeCard.dueComplete,
        });
        existingPlanKeys.add(key);
      }
      await updateTrelloCard(req.user, placeCard.id, {
        due: "null",
        dueComplete: false,
      });
      results.push({
        placeId: placeCard.id,
        planId: created?.id || null,
        alreadyCreated: !created,
      });
    }

    res.json({
      success: true,
      linked: linked.length,
      migrated: results.length,
      linkedResults: linked,
      results,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/api/rate-place", async (req, res, next) => {
  try {
    if (!req.user) return res.status(403).json({ error: "Not authenticated" });

    const { cardId, rating } = req.body;
    if (!cardId || rating == null)
      return res.status(400).json({ error: "Missing cardId or rating" });

    const board = await fetchBoard();
    const { cards, lists, customFields, members } = board;

    const userId =
      req.user.id ||
      req.user.idMember ||
      (req.user.profile && req.user.profile.id);
    const isMember = members.some(
      (m) =>
        m.id === userId &&
        (m.memberType === "admin" || m.memberType === "normal"),
    );
    if (!isMember) return res.status(403).json({ error: "Not a board member" });

    const placeCard = resolvePlaceCard(cards, lists, cardId);
    if (!placeCard) return res.status(404).json({ error: "Place not found" });

    const ratingField = customFields.find((f) => f.name === "⭐️");
    if (!ratingField)
      return res.status(500).json({ error: "Rating field not found" });

    const parsed = parseInt(rating, 10);
    if (!parsed || parsed < 1 || parsed > 5)
      return res.status(400).json({ error: "Invalid rating" });

    let payload;
    if (Array.isArray(ratingField.options)) {
      const opt = ratingField.options.find(
        (o) => o.value && o.value.text === String(parsed),
      );
      if (!opt)
        return res.status(400).json({ error: "Rating option not found" });
      payload = { idValue: opt.id };
    } else {
      payload = { value: { text: String(parsed) } };
    }

    const oauth = {
      consumer_key: process.env.TRELLO_OAUTH_KEY,
      consumer_secret: process.env.TRELLO_OAUTH_SECRET,
      token: req.user.token,
      token_secret: req.user.tokenSecret,
    };
    const oauth1a = require("oauth-1.0a");
    const crypto = require("crypto");
    const oauthClient = oauth1a({
      consumer: { key: oauth.consumer_key, secret: oauth.consumer_secret },
      signature_method: "HMAC-SHA1",
      hash_function(base_string, key) {
        return crypto
          .createHmac("sha1", key)
          .update(base_string)
          .digest("base64");
      },
    });

    const url = `https://api.trello.com/1/cards/${placeCard.id}/customField/${ratingField.id}/item`;
    const request_data = { url, method: "PUT", data: payload };
    const headers = oauthClient.toHeader(
      oauthClient.authorize(request_data, {
        key: oauth.token,
        secret: oauth.token_secret,
      }),
    );

    await axios.put(url, payload, { headers });
    invalidateBoardCache();
    res.json({ success: true });
  } catch (err) {
    console.log("Error in /api/rate-place:", err);
    next(err);
  }
});

router.post("/api/update-labels", async (req, res, next) => {
  try {
    if (!req.user) return res.status(403).json({ error: "Not authenticated" });

    const { cardId, labels } = req.body;
    if (!cardId || !Array.isArray(labels)) {
      return res.status(400).json({ error: "Missing cardId or labels" });
    }

    const board = await fetchBoard();
    const { cards, lists, members } = board;
    const userId =
      req.user.id ||
      req.user.idMember ||
      (req.user.profile && req.user.profile.id);
    const isMember = members.some(
      (m) =>
        m.id === userId &&
        (m.memberType === "admin" || m.memberType === "normal"),
    );
    if (!isMember) return res.status(403).json({ error: "Not a board member" });

    const placeCard = resolvePlaceCard(cards, lists, cardId);
    if (!placeCard) return res.status(404).json({ error: "Place not found" });
    const placeCardId = placeCard.id;

    const oauth = {
      consumer_key: process.env.TRELLO_OAUTH_KEY,
      consumer_secret: process.env.TRELLO_OAUTH_SECRET,
      token: req.user.token,
      token_secret: req.user.tokenSecret,
    };
    const oauth1a = require("oauth-1.0a");
    const crypto = require("crypto");
    const oauthClient = oauth1a({
      consumer: { key: oauth.consumer_key, secret: oauth.consumer_secret },
      signature_method: "HMAC-SHA1",
      hash_function(base_string, key) {
        return crypto
          .createHmac("sha1", key)
          .update(base_string)
          .digest("base64");
      },
    });

    const getUrl = `https://api.trello.com/1/cards/${placeCardId}?fields=idLabels`;
    const getReq = { url: getUrl, method: "GET" };
    const getHeaders = oauthClient.toHeader(
      oauthClient.authorize(getReq, {
        key: oauth.token,
        secret: oauth.token_secret,
      }),
    );
    const cardRes = await axios.get(getUrl, {
      headers: getHeaders,
    });
    const current = cardRes.data.idLabels || [];

    const toAdd = labels.filter((id) => !current.includes(id));
    const toRemove = current.filter((id) => !labels.includes(id));

    for (const id of toAdd) {
      const url = `https://api.trello.com/1/cards/${placeCardId}/idLabels`;
      const request_data = { url, method: "POST", data: { value: id } };
      const headers = oauthClient.toHeader(
        oauthClient.authorize(request_data, {
          key: oauth.token,
          secret: oauth.token_secret,
        }),
      );
      await axios.post(url, null, { params: { value: id }, headers });
    }

    for (const id of toRemove) {
      const url = `https://api.trello.com/1/cards/${placeCardId}/idLabels/${id}`;
      const request_data = { url, method: "DELETE" };
      const headers = oauthClient.toHeader(
        oauthClient.authorize(request_data, {
          key: oauth.token,
          secret: oauth.token_secret,
        }),
      );
      await axios.delete(url, { headers });
    }

    invalidateBoardCache();
    res.json({ success: true });
  } catch (err) {
    console.log("Error in /api/update-labels:", err);
    next(err);
  }
});

module.exports = router;
