const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const axios = require("axios");

process.env.TRELLO_BOARD_ID = "test-board";
process.env.TRELLO_KEY = "test-board-key";
process.env.TRELLO_TOKEN = "test-board-token";
process.env.TRELLO_OAUTH_KEY = "test-oauth-key";
process.env.TRELLO_OAUTH_SECRET = "test-oauth-secret";

const captainsLog = require("../routes/captainsLog");
const {
  extractTrelloCardShortLink,
  removeLegacyPlanMetadata,
  resolvePlanPlaceCard,
} = require("../services/plans");
const {
  invalidateBoardCache,
  invalidateCommentCache,
} = require("../services/trello");

async function startServer(user = null) {
  const app = express();
  app.use(express.json());
  if (user) {
    app.use((req, _res, next) => {
      req.user = user;
      next();
    });
  }
  app.use(captainsLog);
  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: error.message });
  });
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function locationFields() {
  return [
    { id: "latitude", name: "Latitude" },
    { id: "longitude", name: "Longitude" },
  ];
}

function placeCard(id, name, due = null) {
  return {
    id,
    idList: "places-list",
    name,
    desc: `${name} description`,
    due,
    dueComplete: false,
    labels: [],
    shortLink: id,
    shortUrl: `https://trello.com/c/${id}`,
    customFieldItems: [
      { idCustomField: "latitude", value: { number: "37.5" } },
      { idCustomField: "longitude", value: { number: "23.4" } },
    ],
  };
}

test("resolves a permanent place from a Plan card attachment", () => {
  const poros = placeCard("poros", "Poros");
  const planCard = {
    attachments: [{ name: "Poros", url: "https://trello.com/c/poros/poros" }],
  };
  assert.equal(
    extractTrelloCardShortLink(planCard.attachments[0].url),
    "poros",
  );
  assert.equal(resolvePlanPlaceCard(planCard, [poros]), poros);
});

test("removes first-generation Plan metadata without erasing visit notes", () => {
  const description = [
    "captains-log-plan: 1",
    "placeCardId: place-1",
    "migratedFromDue: 2027-07-01T08:00:00.000Z",
    "",
    "Place: https://trello.com/c/place1",
    "",
    "Call ahead for a berth.",
  ].join("\n");
  assert.equal(
    removeLegacyPlanMetadata(description),
    "Call ahead for a berth.",
  );
});

test("API data returns distinct Plan occurrences joined to one place", async (t) => {
  invalidateBoardCache();
  invalidateCommentCache();
  const originalGet = axios.get;
  const board = {
    lists: [
      { id: "places-list", name: "Saronic" },
      { id: "plan-list", name: "Plan" },
      { id: "trips-list", name: "Trips" },
    ],
    cards: [
      placeCard("poros", "Poros"),
      placeCard("aegina", "Aegina", "2027-07-03T08:00:00.000Z"),
      {
        id: "poros-visit-1",
        idList: "plan-list",
        name: "Poros",
        desc: "First visit notes",
        attachments: [{ url: "https://trello.com/c/poros" }],
        due: "2027-07-01T08:00:00.000Z",
        dueComplete: false,
        shortUrl: "https://trello.com/c/poros-visit-1",
      },
      {
        id: "poros-visit-2",
        idList: "plan-list",
        name: "Poros",
        desc: "Return visit notes",
        attachments: [{ url: "https://trello.com/c/poros" }],
        due: "2027-07-10T08:00:00.000Z",
        dueComplete: false,
        shortUrl: "https://trello.com/c/poros-visit-2",
      },
    ],
    customFields: locationFields(),
    members: [],
    labels: [],
  };
  axios.get = async (url) => ({
    data: String(url).includes("/actions?") ? [] : board,
  });
  t.after(() => {
    axios.get = originalGet;
    invalidateBoardCache();
    invalidateCommentCache();
  });

  const server = await startServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/data`,
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    result.stops.map(({ id, planId, placeId, legacyPlan }) => ({
      id,
      planId,
      placeId,
      legacyPlan,
    })),
    [
      {
        id: "poros-visit-1",
        planId: "poros-visit-1",
        placeId: "poros",
        legacyPlan: false,
      },
      {
        id: "aegina",
        planId: null,
        placeId: "aegina",
        legacyPlan: true,
      },
      {
        id: "poros-visit-2",
        planId: "poros-visit-2",
        placeId: "poros",
        legacyPlan: false,
      },
    ],
  );
  assert.deepEqual(result.places.map((place) => place.id).sort(), [
    "aegina",
    "poros",
  ]);
  assert.deepEqual(result.placeLists, [{ id: "places-list", name: "Saronic" }]);
});

test("migration creates linked Plan cards before clearing legacy due dates", async (t) => {
  invalidateBoardCache();
  const originalGet = axios.get;
  const originalPost = axios.post;
  const originalPut = axios.put;
  const creates = [];
  const updates = [];
  const board = {
    lists: [
      { id: "places-list", name: "Saronic" },
      { id: "plan-list", name: "Plan" },
    ],
    cards: [placeCard("poros", "Poros", "2027-07-01T08:00:00.000Z")],
    customFields: locationFields(),
    members: [{ id: "captain", memberType: "normal" }],
    labels: [],
  };
  axios.get = async () => ({ data: board });
  axios.post = async (url, body, options) => {
    creates.push({ url, body, options });
    return { data: { id: "new-plan-card" } };
  };
  axios.put = async (url, body, options) => {
    updates.push({ url, body, options });
    return { data: {} };
  };
  t.after(() => {
    axios.get = originalGet;
    axios.post = originalPost;
    axios.put = originalPut;
    invalidateBoardCache();
  });

  const server = await startServer({
    id: "captain",
    token: "member-token",
    tokenSecret: "member-secret",
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/plan/migrate`,
    { method: "POST" },
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.migrated, 1);
  assert.equal(creates.length, 2);
  assert.equal(creates[0].options.params.idList, "plan-list");
  assert.equal(creates[0].options.params.desc, "");
  assert.equal(
    creates[1].url,
    "https://api.trello.com/1/cards/new-plan-card/attachments",
  );
  assert.deepEqual(creates[1].options.params, {
    name: "Poros",
    url: "https://trello.com/c/poros",
  });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].url, "https://api.trello.com/1/cards/poros");
  assert.deepEqual(updates[0].options.params, {
    due: "null",
    dueComplete: false,
  });
});

test("migration attaches legacy Plan cards before freeing their descriptions", async (t) => {
  invalidateBoardCache();
  const originalGet = axios.get;
  const originalPost = axios.post;
  const originalPut = axios.put;
  const operations = [];
  const board = {
    lists: [
      { id: "places-list", name: "Saronic" },
      { id: "plan-list", name: "Plan" },
    ],
    cards: [
      placeCard("russianbay", "Russian Bay"),
      {
        id: "russian-plan",
        idList: "plan-list",
        name: "Russian Bay",
        desc: [
          "captains-log-plan: 1",
          "placeCardId: russianbay",
          "migratedFromDue: 2027-07-01T08:00:00.000Z",
          "",
          "Place: https://trello.com/c/russianbay",
        ].join("\n"),
        attachments: [],
        due: "2027-07-01T08:00:00.000Z",
        dueComplete: false,
      },
    ],
    customFields: locationFields(),
    members: [{ id: "captain", memberType: "normal" }],
    labels: [],
  };
  axios.get = async () => ({ data: board });
  axios.post = async (url, body, options) => {
    operations.push({ method: "POST", url, body, options });
    return { data: { id: "attachment" } };
  };
  axios.put = async (url, body, options) => {
    operations.push({ method: "PUT", url, body, options });
    return { data: {} };
  };
  t.after(() => {
    axios.get = originalGet;
    axios.post = originalPost;
    axios.put = originalPut;
    invalidateBoardCache();
  });

  const server = await startServer({
    id: "captain",
    token: "member-token",
    tokenSecret: "member-secret",
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/plan/migrate`,
    { method: "POST" },
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.linked, 1);
  assert.equal(result.migrated, 0);
  assert.equal(operations[0].method, "POST");
  assert.equal(
    operations[0].url,
    "https://api.trello.com/1/cards/russian-plan/attachments",
  );
  assert.deepEqual(operations[0].options.params, {
    name: "Russian Bay",
    url: "https://trello.com/c/russianbay",
  });
  assert.equal(operations[1].method, "PUT");
  assert.deepEqual(operations[1].options.params, { desc: "" });
});

test("plan operations create, reschedule, reorder, and archive occurrence cards", async (t) => {
  invalidateBoardCache();
  const originalGet = axios.get;
  const originalPost = axios.post;
  const originalPut = axios.put;
  const creates = [];
  const updates = [];
  const board = {
    lists: [
      { id: "places-list", name: "Saronic" },
      { id: "plan-list", name: "Plan" },
    ],
    cards: [
      placeCard("poros", "Poros"),
      {
        id: "existing-plan",
        idList: "plan-list",
        name: "Poros",
        desc: "Visit notes",
        attachments: [{ url: "https://trello.com/c/poros" }],
        due: "2027-07-01T08:00:00.000Z",
        dueComplete: false,
      },
    ],
    customFields: locationFields(),
    members: [{ id: "captain", memberType: "normal" }],
    labels: [],
  };
  axios.get = async () => ({ data: board });
  axios.post = async (url, body, options) => {
    creates.push({ url, body, options });
    return { data: { id: "created-plan" } };
  };
  axios.put = async (url, body, options) => {
    updates.push({ url, body, options });
    return { data: {} };
  };
  t.after(() => {
    axios.get = originalGet;
    axios.post = originalPost;
    axios.put = originalPut;
    invalidateBoardCache();
  });

  const server = await startServer({
    id: "captain",
    token: "member-token",
    tokenSecret: "member-secret",
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseURL = `http://127.0.0.1:${server.address().port}`;

  const createResponse = await fetch(`${baseURL}/api/plan-stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      placeId: "poros",
      due: "2027-07-10T08:00:00.000Z",
    }),
  });
  assert.equal(createResponse.status, 201);
  assert.equal((await createResponse.json()).planId, "created-plan");
  assert.equal(creates[0].options.params.idList, "plan-list");
  assert.equal(creates[0].options.params.desc, "");
  assert.equal(
    creates[1].url,
    "https://api.trello.com/1/cards/created-plan/attachments",
  );

  const rescheduleResponse = await fetch(`${baseURL}/api/plan-stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      planId: "existing-plan",
      placeId: "poros",
      due: "2027-07-02T12:00:00.000Z",
    }),
  });
  assert.equal(rescheduleResponse.status, 200);
  assert.deepEqual(updates.at(-1).options.params, {
    due: "2027-07-02T12:00:00.000Z",
    dueComplete: false,
  });

  const reorderResponse = await fetch(`${baseURL}/api/reorder-stops`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      updates: [{ planId: "existing-plan", due: "2027-07-03T16:00:00.000Z" }],
    }),
  });
  assert.equal(reorderResponse.status, 200);
  assert.deepEqual(updates.at(-1).options.params, {
    due: "2027-07-03T16:00:00.000Z",
  });

  const removeResponse = await fetch(`${baseURL}/api/remove-stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planId: "existing-plan" }),
  });
  assert.equal(removeResponse.status, 200);
  assert.deepEqual(updates.at(-1).options.params, { closed: true });
});
