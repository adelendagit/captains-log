const axios = require("axios");
const crypto = require("crypto");
const oauth1a = require("oauth-1.0a");

const JOURNEYS_LIST_ID =
  process.env.TRELLO_JOURNEYS_LIST_ID || "6a704f2decc154fd0a4b8550";
const API_ROOT = "https://api.trello.com/1";

function buildJourneyDescription({ status, startedAt, startedBy, endedAt }) {
  return [
    "captains-log-journey: 1",
    `status: ${status}`,
    `startedAt: ${startedAt}`,
    `startedBy: ${startedBy}`,
    endedAt ? `endedAt: ${endedAt}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function parseJourneyDescription(description = "") {
  const values = {};
  for (const line of String(description).split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  if (values["captains-log-journey"] !== "1") return null;
  return {
    status: values.status || "unknown",
    startedAt: values.startedAt || null,
    startedBy: values.startedBy || null,
    endedAt: values.endedAt || null,
  };
}

function findActiveJourney(cards) {
  return cards
    .map((card) => ({
      card,
      metadata: parseJourneyDescription(card.desc),
    }))
    .filter(
      ({ metadata }) =>
        metadata?.status === "active" &&
        metadata.startedAt &&
        !Number.isNaN(new Date(metadata.startedAt).getTime()),
    )
    .sort(
      (a, b) =>
        new Date(b.metadata.startedAt || 0) -
        new Date(a.metadata.startedAt || 0),
    )[0];
}

function buildPositionComment(position) {
  const lines = [
    "position",
    `timestamp: ${position.timestamp}`,
    `lat: ${position.lat}`,
    `lng: ${position.lng}`,
  ];

  if (position.accuracy != null) lines.push(`accuracy: ${position.accuracy}`);
  if (position.speedKts != null) lines.push(`speedKts: ${position.speedKts}`);
  if (position.course != null) lines.push(`course: ${position.course}`);
  if (position.altitude != null) lines.push(`altitude: ${position.altitude}`);
  if (position.sampleId) lines.push(`sampleId: ${position.sampleId}`);
  lines.push(`source: ${position.source || "ios"}`);
  return lines.join("\n");
}

function parsePositionComment(text = "") {
  const lines = String(text).split("\n");
  if (lines[0].trim().toLowerCase() !== "position") return null;

  const values = {};
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  const timestamp = new Date(values.timestamp);
  const lat = Number(values.lat);
  const lng = Number(values.lng);
  if (
    Number.isNaN(timestamp.getTime()) ||
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  const optionalNumber = (key) => {
    if (values[key] == null || values[key] === "") return null;
    const value = Number(values[key]);
    return Number.isFinite(value) ? value : null;
  };

  return {
    timestamp: timestamp.toISOString(),
    lat,
    lng,
    accuracy: optionalNumber("accuracy"),
    speedKts: optionalNumber("speedKts"),
    course: optionalNumber("course"),
    altitude: optionalNumber("altitude"),
    sampleId: values.sampleId || null,
    source: values.source || null,
  };
}

function buildJourneyHistory(card, actions = []) {
  const metadata = parseJourneyDescription(card?.desc);
  if (!card || !metadata?.startedAt) return null;

  const track = actions
    .map((action) => parsePositionComment(action.data?.text))
    .filter(Boolean)
    .sort(
      (left, right) => new Date(left.timestamp) - new Date(right.timestamp),
    );

  return {
    id: card.id,
    name: card.name,
    startedAt: metadata.startedAt,
    endedAt: metadata.endedAt,
    track,
  };
}

function createOAuthClient(user) {
  const consumerKey = process.env.TRELLO_OAUTH_KEY;
  const consumerSecret = process.env.TRELLO_OAUTH_SECRET;
  if (!consumerKey || !consumerSecret || !user?.token || !user?.tokenSecret) {
    const error = new Error("Trello authentication is not configured");
    error.status = 503;
    throw error;
  }

  const client = oauth1a({
    consumer: { key: consumerKey, secret: consumerSecret },
    signature_method: "HMAC-SHA1",
    hash_function(baseString, key) {
      return crypto.createHmac("sha1", key).update(baseString).digest("base64");
    },
  });

  return {
    client,
    token: { key: user.token, secret: user.tokenSecret },
  };
}

async function authenticatedRequest(user, method, url, data = {}) {
  const { client, token } = createOAuthClient(user);
  const requestData = { url, method, data };
  const headers = client.toHeader(client.authorize(requestData, token));
  const response = await axios.request({ method, url, params: data, headers });
  return response.data;
}

function serviceCredentials() {
  const key = process.env.TRELLO_KEY;
  const token = process.env.TRELLO_TOKEN;
  if (!key || !token) {
    const error = new Error("Trello board credentials are not configured");
    error.status = 503;
    throw error;
  }
  return { key, token };
}

async function fetchJourneyCards() {
  const { key, token } = serviceCredentials();
  const { data } = await axios.get(
    `${API_ROOT}/lists/${JOURNEYS_LIST_ID}/cards`,
    {
      params: {
        key,
        token,
        filter: "open",
        fields: "id,name,desc,dateLastActivity,shortUrl,idList",
      },
    },
  );
  return data;
}

async function fetchJourneyComments(cardId, limit = 50) {
  const { key, token } = serviceCredentials();
  const { data } = await axios.get(`${API_ROOT}/cards/${cardId}/actions`, {
    params: {
      key,
      token,
      filter: "commentCard",
      limit,
      fields: "data,date",
      memberCreator: false,
    },
  });
  return data;
}

async function createJourney(user, { name, startedAt, startedBy }) {
  const desc = buildJourneyDescription({
    status: "active",
    startedAt,
    startedBy,
  });
  return authenticatedRequest(user, "POST", `${API_ROOT}/cards`, {
    idList: JOURNEYS_LIST_ID,
    name,
    desc,
    pos: "top",
  });
}

async function appendJourneyComment(user, cardId, text) {
  return authenticatedRequest(
    user,
    "POST",
    `${API_ROOT}/cards/${cardId}/actions/comments`,
    { text },
  );
}

async function endJourney(user, card, { endedAt, endedBy }) {
  const metadata = parseJourneyDescription(card.desc);
  const desc = buildJourneyDescription({
    status: "ended",
    startedAt: metadata.startedAt,
    startedBy: metadata.startedBy,
    endedAt,
  });

  await appendJourneyComment(
    user,
    card.id,
    ["journey-ended", `timestamp: ${endedAt}`, `endedBy: ${endedBy}`].join(
      "\n",
    ),
  );
  return authenticatedRequest(user, "PUT", `${API_ROOT}/cards/${card.id}`, {
    desc,
  });
}

module.exports = {
  JOURNEYS_LIST_ID,
  appendJourneyComment,
  buildJourneyHistory,
  buildPositionComment,
  createJourney,
  endJourney,
  fetchJourneyCards,
  fetchJourneyComments,
  findActiveJourney,
  parseJourneyDescription,
  parsePositionComment,
};
