const express = require("express");
const router = express.Router();
const axios = require("axios");
const {
  fetchBoard,
  fetchBoardWithAllComments,
  fetchCommentPage,
  fetchRecentComments,
  fetchBoardWithCredentials,
  invalidateBoardCache,
} = require("../services/trello");
const { ACTION_LABELS, sendLogNotification } = require("../services/email");
const { buildPlanningRoute } = require("../services/planningRoute");
const { buildSeaRoute } = require("../services/seaRoute");
const {
  createJourney,
  endJourney,
  fetchJourneyCards,
  findActiveJourney,
} = require("../services/journeys");

let currentStopCache = null;
let currentStopCacheExpiresAt = 0;
let currentStopRequest = null;
const CURRENT_STATUS_COMMENT_LIMIT = 200;

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

// existing number helper
function getCFNumber(card, boardCFs, name) {
  const def = boardCFs.find((f) => f.name === name);
  const item = card.customFieldItems.find((i) => i.idCustomField === def.id);
  return item?.value?.number ? Number(item.value.number) : null;
}
// updated text/dropdown helper:
function getCFTextOrDropdown(card, boardCFs, name) {
  const def = boardCFs.find((f) => f.name === name);
  if (!def) return null;
  const item = card.customFieldItems.find((i) => i.idCustomField === def.id);
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
  }));

  return {
    id: card.id,
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

function deriveCurrentStatus(cards, lists, customFields, comments) {
  const listNames = Object.fromEntries(lists.map((l) => [l.id, l.name]));
  const tripsList = lists.find((l) => l.name === "Trips");
  const tripsListId = tripsList ? tripsList.id : null;

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

  const upcomingStops = cards
    .filter((c) => c.due && !c.dueComplete && c.idList !== tripsListId)
    .sort((a, b) => new Date(a.due) - new Date(b.due));
  const plannedDestination = buildStopPayload(
    upcomingStops[0],
    listNames,
    customFields,
  );

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
    const [{ cards, lists, customFields }, recentComments] = await Promise.all([
      fetchBoard(),
      fetchRecentComments(CURRENT_STATUS_COMMENT_LIMIT),
    ]);
    currentStopCache = deriveCurrentStatus(
      cards,
      lists,
      customFields,
      recentComments,
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
    const {
      cards,
      lists,
      customFields,
      members,
      labels: boardLabelsRaw,
    } = await fetchBoard();

    const tripsListId = lists.find((l) => l.name === "Trips").id;

    // map of list IDs → names
    const listNames = Object.fromEntries(lists.map((l) => [l.id, l.name]));

    const stops = cards
      .filter((c) => c.due && c.idList !== tripsListId)
      .map((c) => {
        const ratingText = getCFTextOrDropdown(c, customFields, "⭐️");
        const ratingNum = ratingText != null ? parseInt(ratingText, 10) : null;
        const labels = (c.labels || []).map((l) => ({
          id: l.id,
          name: l.name,
          color: colorMap[l.color] || "#888",
        }));

        return {
          id: c.id,
          name: c.name,
          listName: listNames[c.idList],
          due: c.due,
          dueComplete: c.dueComplete,
          lat: getCFNumber(c, customFields, "Latitude"),
          lng: getCFNumber(c, customFields, "Longitude"),
          rating: ratingNum,
          trelloUrl: c.shortUrl,
          navilyUrl: getCFTextOrDropdown(c, customFields, "Navily"),
          desc: c.desc,
          labels,
        };
      })
      .sort((a, b) => new Date(a.due) - new Date(b.due));

    const places = cards
      .filter(
        (c) =>
          !c.due &&
          c.idList !== tripsListId &&
          getCFNumber(c, customFields, "Latitude") != null &&
          getCFNumber(c, customFields, "Longitude") != null,
      )
      .map((c) => {
        const ratingText = getCFTextOrDropdown(c, customFields, "⭐️");
        const labels = (c.labels || []).map((l) => ({
          id: l.id,
          name: l.name,
          color: colorMap[l.color] || "#888",
        }));
        return {
          id: c.id,
          name: c.name,
          listName: listNames[c.idList],
          lat: getCFNumber(c, customFields, "Latitude"),
          lng: getCFNumber(c, customFields, "Longitude"),
          rating: ratingText !== null ? parseInt(ratingText, 10) : null,
          trelloUrl: c.shortUrl,
          desc: c.desc,
          labels,
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

    res.json({ stops, places, canPlan, boardLabels });
  } catch (err) {
    next(err);
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
    res.set("Cache-Control", "public, max-age=30");
    res.json(result);
  } catch (err) {
    next(err);
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
            (a, b) =>
              new Date(b.start || b.end) - new Date(a.start || a.end),
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
          currentStop.destination?.id ||
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
      cardId,
      lat,
      latitude,
      long,
      lng,
      longitude,
      timestamp,
      source,
      litres,
      journeyName,
      placeName,
      customText,
      mooringLabelId,
    } = req.body || {};

    const normalizedAction = String(action || "")
      .trim()
      .toLowerCase();
    const allowedActions = [
      "arrived",
      "departed",
      "visited",
      "water",
      "diesel",
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
    if (normalizedAction === "arrived" && mooringLabelId) {
      const board = await fetchBoard();
      mooringLabel = (board.labels || []).find(
        (label) => label.id === mooringLabelId && label.color === "orange",
      );
      destinationCard = (board.cards || []).find((card) => card.id === cardId);
      if (!mooringLabel) {
        return res.status(400).json({ error: "Invalid mooring type" });
      }
      if (!destinationCard) {
        return res.status(400).json({ error: "Location card was not found" });
      }
    }

    const actionLabels = {
      arrived: "Arrived",
      departed: "Departed",
      visited: "Visited",
      water: "Water",
      diesel: "Diesel",
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

    const headline =
      normalizedAction === "other"
        ? `Other: ${suppliedCustomText}`
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
    const clearsPlannedStopDueDate = normalizedAction === "departed";
    const cardUpdate = completesPlannedStop
      ? { dueComplete: true }
      : clearsPlannedStopDueDate
        ? { due: "null" }
        : null;
    const updateCard = async () => {
      if (!cardUpdate) return;
      const cardUrl = `https://api.trello.com/1/cards/${cardId}`;
      const updateRequest = {
        url: cardUrl,
        method: "PUT",
        data: cardUpdate,
      };
      const updateHeaders = oauthClient.toHeader(
        oauthClient.authorize(updateRequest, {
          key: oauth.token,
          secret: oauth.token_secret,
        }),
      );

      await axios.put(cardUrl, null, {
        params: cardUpdate,
        headers: updateHeaders,
      });
      invalidateBoardCache();
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

    if (clearsPlannedStopDueDate) await updateCard();

    await axios.post(url, null, {
      params: { text },
      headers,
    });

    const mooringLabelAdded = await addMooringLabel();

    if (completesPlannedStop) await updateCard();

    currentStopCache = null;
    currentStopCacheExpiresAt = 0;

    res.json({
      success: true,
      comment: text,
      dueComplete: completesPlannedStop,
      dueCleared: clearsPlannedStopDueDate,
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

    const { cards, members } = await fetchBoard();
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

    const card = cards.find((candidate) => candidate.id === cardId);
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
    });

    res.json({ success: true, ...result });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    next(error);
  }
});

router.get("/captains-log", (req, res) => {
  // Keep the initial HTML independent of Trello so the page shell can render
  // immediately. Chart and voyage data are filled in asynchronously.
  res.render("captains-log", { historical: [], user: req.user });
});

router.post("/api/plan-stop", async (req, res, next) => {
  try {
    if (!req.user) return res.status(403).json({ error: "Not authenticated" });
    // Optionally, check if user is a board member/admin here

    const { cardId, due } = req.body;
    console.log("Planning stop:", cardId, due);
    // Update the card's due date via Trello API
    const oauth = {
      consumer_key: process.env.TRELLO_OAUTH_KEY,
      consumer_secret: process.env.TRELLO_OAUTH_SECRET,
      token: req.user.token,
      token_secret: req.user.tokenSecret,
    };

    const url = `https://api.trello.com/1/cards/${cardId}/due`;

    const oauth1a = require("oauth-1.0a");
    const crypto = require("crypto");

    // Create OAuth1.0a signature
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

    const request_data = {
      url,
      method: "PUT",
      data: { value: due },
    };

    const headers = oauthClient.toHeader(
      oauthClient.authorize(request_data, {
        key: oauth.token,
        secret: oauth.token_secret,
      }),
    );

    await axios.put(url, null, {
      params: { value: due },
      headers,
    });
    invalidateBoardCache();
    res.json({ success: true });
  } catch (err) {
    console.log("Error in /api/plan-stop:", err);
    next(err);
  }
});

router.post("/api/remove-stop", async (req, res, next) => {
  try {
    if (!req.user) return res.status(403).json({ error: "Not authenticated" });

    const { cardId } = req.body;
    if (!cardId) return res.status(400).json({ error: "Missing cardId" });

    // Use user's Trello OAuth credentials as in /api/plan-stop
    const oauth = {
      consumer_key: process.env.TRELLO_OAUTH_KEY,
      consumer_secret: process.env.TRELLO_OAUTH_SECRET,
      token: req.user.token,
      token_secret: req.user.tokenSecret,
    };

    const url = `https://api.trello.com/1/cards/${cardId}/due`;

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

    const request_data = {
      url,
      method: "PUT",
      data: { value: null },
    };

    const headers = oauthClient.toHeader(
      oauthClient.authorize(request_data, {
        key: oauth.token,
        secret: oauth.token_secret,
      }),
    );

    // Set due to null to "unplan" the stop
    await axios.put(url, null, {
      params: { value: null },
      headers,
    });
    invalidateBoardCache();
    res.json({ success: true });
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

    // Update each card's due date
    for (const { cardId, due } of updates) {
      const url = `https://api.trello.com/1/cards/${cardId}/due`;
      const request_data = { url, method: "PUT", data: { value: due } };
      const headers = oauthClient.toHeader(
        oauthClient.authorize(request_data, {
          key: oauth.token,
          secret: oauth.token_secret,
        }),
      );
      console.log("Reordering stop:", cardId, due);
      console.log(`https://trello.com/c/${cardId}`);
      const response = await axios.put(url, null, {
        params: { value: due },
        headers,
      });
      console.log("Trello API response:", response.data);
    }
    invalidateBoardCache();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post("/api/rate-place", async (req, res, next) => {
  try {
    if (!req.user) return res.status(403).json({ error: "Not authenticated" });

    const { cardId, rating } = req.body;
    if (!cardId || rating == null)
      return res.status(400).json({ error: "Missing cardId or rating" });

    const board = await fetchBoard();
    const { customFields, members } = board;

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

    const url = `https://api.trello.com/1/cards/${cardId}/customField/${ratingField.id}/item`;
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
    const { members } = board;
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

    const getUrl = `https://api.trello.com/1/cards/${cardId}?fields=idLabels`;
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
      const url = `https://api.trello.com/1/cards/${cardId}/idLabels`;
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
      const url = `https://api.trello.com/1/cards/${cardId}/idLabels/${id}`;
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
