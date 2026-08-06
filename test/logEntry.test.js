const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const axios = require("axios");

process.env.TRELLO_KEY = "test-board-key";
process.env.TRELLO_TOKEN = "test-board-token";
process.env.TRELLO_OAUTH_KEY = "test-oauth-key";
process.env.TRELLO_OAUTH_SECRET = "test-oauth-secret";

const captainsLog = require("../routes/captainsLog");

test("arriving at or visiting a stop completes its Trello due date", async (t) => {
  const originalPost = axios.post;
  const originalPut = axios.put;
  const originalGet = axios.get;
  const originalRequest = axios.request;
  const requests = [];
  const journeyRequests = [];
  let activeJourneyCards = [];

  axios.post = async (url, body, options) => {
    requests.push({ method: "POST", url, body, options });
    return { data: {} };
  };
  axios.put = async (url, body, options) => {
    requests.push({ method: "PUT", url, body, options });
    return { data: {} };
  };
  axios.get = async () => ({ data: activeJourneyCards });
  axios.request = async (options) => {
    journeyRequests.push(options);
    return { data: {} };
  };
  t.after(() => {
    axios.post = originalPost;
    axios.put = originalPut;
    axios.get = originalGet;
    axios.request = originalRequest;
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: "test-member",
      token: "test-token",
      tokenSecret: "test-token-secret",
    };
    next();
  });
  app.use(captainsLog);
  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, "127.0.0.1", () =>
      resolve(listeningServer),
    );
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  for (const action of ["arrived", "visited"]) {
    requests.length = 0;
    journeyRequests.length = 0;
    activeJourneyCards =
      action === "arrived"
        ? [
            {
              id: "active-journey-card",
              name: "Channel Rock Bay → Wasp Bay",
              desc: [
                "captains-log-journey: 1",
                "status: active",
                "startedAt: 2026-08-05T08:00:00.000Z",
                "startedBy: test-member",
              ].join("\n"),
            },
          ]
        : [];
    const response = await fetch(`http://127.0.0.1:${port}/api/log-entry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        cardId: "stop-card",
        lat: 37.5205,
        lng: 23.4113,
        timestamp: "2026-08-05T09:00:00.000Z",
      }),
    });
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.dueComplete, true);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].method, "POST");
    assert.equal(
      requests[0].url,
      "https://api.trello.com/1/cards/stop-card/actions/comments",
    );
    assert.equal(requests[1].method, "PUT");
    assert.equal(requests[1].url, "https://api.trello.com/1/cards/stop-card");
    assert.deepEqual(requests[1].options.params, { dueComplete: true });
    assert.equal(result.journey.ended, action === "arrived");
    assert.equal(journeyRequests.length, action === "arrived" ? 2 : 0);
    if (action === "arrived") {
      assert.equal(journeyRequests[0].method, "POST");
      assert.equal(
        journeyRequests[0].url,
        "https://api.trello.com/1/cards/active-journey-card/actions/comments",
      );
      assert.equal(journeyRequests[1].method, "PUT");
      assert.equal(
        journeyRequests[1].params.desc.includes(
          "endedAt: 2026-08-05T09:00:00.000Z",
        ),
        true,
      );
    }
  }
});

test("departing a stop clears its Trello due date", async (t) => {
  const originalPost = axios.post;
  const originalPut = axios.put;
  const originalGet = axios.get;
  const originalRequest = axios.request;
  const updates = [];
  const journeyRequests = [];
  const operationOrder = [];

  axios.post = async () => {
    operationOrder.push("log-departed");
    return { data: {} };
  };
  axios.put = async (url, body, options) => {
    operationOrder.push("clear-due-date");
    updates.push({ url, body, options });
    return { data: {} };
  };
  axios.get = async () => ({ data: [] });
  axios.request = async (options) => {
    operationOrder.push("start-journey");
    journeyRequests.push(options);
    return { data: { id: "journey-card", name: options.params.name } };
  };
  t.after(() => {
    axios.post = originalPost;
    axios.put = originalPut;
    axios.get = originalGet;
    axios.request = originalRequest;
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: "test-member",
      token: "test-token",
      tokenSecret: "test-token-secret",
    };
    next();
  });
  app.use(captainsLog);
  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: error.message });
  });

  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, "127.0.0.1", () =>
      resolve(listeningServer),
    );
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/log-entry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "departed",
      cardId: "stop-card",
      lat: 37.5228,
      lng: 23.4262,
      timestamp: "2026-08-05T08:00:00.000Z",
      journeyName: "Channel Rock Bay → Wasp Bay",
      placeName: "Channel Rock Bay",
    }),
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.dueComplete, false);
  assert.equal(result.dueCleared, true);
  assert.equal(result.journey.started, true);
  assert.equal(result.journey.journey.name, "Channel Rock Bay → Wasp Bay");
  assert.equal(journeyRequests.length, 1);
  assert.equal(journeyRequests[0].method, "POST");
  assert.equal(journeyRequests[0].url, "https://api.trello.com/1/cards");
  assert.equal(journeyRequests[0].params.name, "Channel Rock Bay → Wasp Bay");
  assert.equal(
    journeyRequests[0].params.desc.includes(
      "startedAt: 2026-08-05T08:00:00.000Z",
    ),
    true,
  );
  assert.equal(updates.length, 1);
  assert.equal(updates[0].url, "https://api.trello.com/1/cards/stop-card");
  assert.deepEqual(updates[0].options.params, { due: "null" });
  assert.deepEqual(operationOrder, [
    "start-journey",
    "clear-due-date",
    "log-departed",
  ]);
});
