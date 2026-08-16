const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const axios = require("axios");
const { invalidateBoardCache } = require("../services/trello");

process.env.TRELLO_KEY = "test-board-key";
process.env.TRELLO_TOKEN = "test-board-token";
process.env.TRELLO_OAUTH_KEY = "test-oauth-key";
process.env.TRELLO_OAUTH_SECRET = "test-oauth-secret";

const captainsLog = require("../routes/captainsLog");

test("arriving at or visiting a stop completes the linked Plan card", async (t) => {
  invalidateBoardCache();
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
  axios.get = async (url) => {
    if (String(url).includes("/lists/")) return { data: activeJourneyCards };
    return {
      data: {
        cards: [
          {
            id: "stop-card",
            idList: "places-list",
            name: "Wasp Bay",
            shortLink: "waspbay",
            labels: [],
            customFieldItems: [],
          },
          {
            id: "plan-card",
            idList: "plan-list",
            name: "Wasp Bay",
            desc: "Visit notes",
            attachments: [{ url: "https://trello.com/c/waspbay" }],
            due: "2026-08-05T09:00:00.000Z",
            dueComplete: false,
          },
        ],
        lists: [
          { id: "places-list", name: "Places" },
          { id: "plan-list", name: "Plan" },
        ],
        customFields: [],
        labels: [],
        members: [{ id: "test-member", memberType: "normal" }],
      },
    };
  };
  axios.request = async (options) => {
    journeyRequests.push(options);
    return { data: {} };
  };
  t.after(() => {
    axios.post = originalPost;
    axios.put = originalPut;
    axios.get = originalGet;
    axios.request = originalRequest;
    invalidateBoardCache();
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
        // Older iOS builds identify a planned row by its Plan card ID. The
        // server resolves that back to the permanent place card.
        cardId: action === "visited" ? "plan-card" : "stop-card",
        lat: 37.5205,
        lng: 23.4113,
        timestamp: "2026-08-05T09:00:00.000Z",
      }),
    });
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.dueComplete, true);
    assert.equal(result.completedPlanId, "plan-card");
    assert.equal(requests.length, 2);
    assert.equal(requests[0].method, "POST");
    assert.equal(
      requests[0].url,
      "https://api.trello.com/1/cards/stop-card/actions/comments",
    );
    assert.equal(requests[1].method, "PUT");
    assert.equal(requests[1].url, "https://api.trello.com/1/cards/plan-card");
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

test("departing archives the completed occurrence and preserves future visits", async (t) => {
  invalidateBoardCache();
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
    operationOrder.push(
      url.endsWith("/completed-plan-card")
        ? "archive-completed-plan"
        : "clear-legacy-due",
    );
    updates.push({ url, body, options });
    return { data: {} };
  };
  axios.get = async (url) => {
    if (String(url).includes("/lists/")) return { data: [] };
    if (String(url).includes("/actions?")) return { data: [] };
    return {
      data: {
        cards: [
          {
            id: "stop-card",
            idList: "places-list",
            name: "Channel Rock Bay",
            shortLink: "channelrock",
            due: "2026-08-05T06:00:00.000Z",
            dueComplete: false,
            labels: [],
            customFieldItems: [],
          },
          {
            id: "completed-plan-card",
            idList: "plan-list",
            name: "Channel Rock Bay",
            desc: "Current visit notes",
            attachments: [{ url: "https://trello.com/c/channelrock" }],
            due: "2026-08-05T07:00:00.000Z",
            dueComplete: true,
          },
          {
            id: "future-plan-card",
            idList: "plan-list",
            name: "Channel Rock Bay",
            desc: "Return visit notes",
            attachments: [{ url: "https://trello.com/c/channelrock" }],
            due: "2026-08-20T09:00:00.000Z",
            dueComplete: false,
          },
        ],
        lists: [
          { id: "places-list", name: "Places" },
          { id: "plan-list", name: "Plan" },
        ],
        customFields: [],
        labels: [],
        members: [{ id: "test-member", memberType: "normal" }],
      },
    };
  };
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
    invalidateBoardCache();
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
      requestId: "ios-departure-1234",
      journeyName: "Channel Rock Bay → Wasp Bay",
      placeName: "Channel Rock Bay",
    }),
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.dueComplete, false);
  assert.equal(result.dueCleared, true);
  assert.equal(result.planArchived, true);
  assert.equal(result.archivedPlanId, "completed-plan-card");
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
  assert.equal(updates.length, 2);
  assert.equal(updates[0].url, "https://api.trello.com/1/cards/stop-card");
  assert.deepEqual(updates[0].options.params, {
    due: "null",
    dueComplete: false,
  });
  assert.equal(
    updates[1].url,
    "https://api.trello.com/1/cards/completed-plan-card",
  );
  assert.deepEqual(updates[1].options.params, { closed: true });
  assert.deepEqual(operationOrder, [
    "start-journey",
    "clear-legacy-due",
    "log-departed",
    "archive-completed-plan",
  ]);
});

test("records the selected orange mooring label and only adds it when missing", async (t) => {
  const originalPost = axios.post;
  const originalPut = axios.put;
  const originalGet = axios.get;
  const comments = [];
  const addedLabels = [];
  let cardHasMooringLabel = false;

  axios.get = async (url) => {
    if (url.includes("/boards/")) {
      return {
        data: {
          cards: [
            {
              id: "stop-card",
              idList: "places-list",
              labels: cardHasMooringLabel
                ? [
                    {
                      id: "mooring-buoy",
                      name: "Mooring buoy",
                      color: "orange",
                    },
                  ]
                : [],
            },
          ],
          lists: [{ id: "places-list", name: "Places" }],
          labels: [
            { id: "mooring-buoy", name: "Mooring buoy", color: "orange" },
            { id: "not-mooring", name: "Sheltered", color: "green" },
          ],
          members: [],
          customFields: [],
        },
      };
    }
    return { data: [] };
  };
  axios.post = async (url, _body, options) => {
    if (url.endsWith("/actions/comments")) {
      comments.push(options.params.text);
    } else if (url.endsWith("/idLabels")) {
      addedLabels.push(options.params.value);
      cardHasMooringLabel = true;
    }
    return { data: {} };
  };
  axios.put = async () => ({ data: {} });
  t.after(() => {
    axios.post = originalPost;
    axios.put = originalPut;
    axios.get = originalGet;
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

  const arrive = (mooringLabelId = "mooring-buoy") =>
    fetch(`http://127.0.0.1:${port}/api/log-entry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "arrived",
        cardId: "stop-card",
        mooringLabelId,
        lat: 37.5205,
        lng: 23.4113,
        timestamp: "2026-08-05T09:00:00.000Z",
      }),
    });

  const firstResponse = await arrive();
  const firstResult = await firstResponse.json();
  assert.equal(firstResponse.status, 200);
  assert.equal(firstResult.mooringLabelAdded, true);
  assert.match(comments[0], /\nmooring: Mooring buoy$/);
  assert.deepEqual(addedLabels, ["mooring-buoy"]);

  const secondResponse = await arrive();
  const secondResult = await secondResponse.json();
  assert.equal(secondResponse.status, 200);
  assert.equal(secondResult.mooringLabelAdded, false);
  assert.match(comments[1], /\nmooring: Mooring buoy$/);
  assert.deepEqual(addedLabels, ["mooring-buoy"]);

  const invalidResponse = await arrive("not-mooring");
  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), {
    error: "Invalid mooring type",
  });
  assert.equal(comments.length, 2);
});

test("logs water tank changes and custom Other text", async (t) => {
  const originalPost = axios.post;
  const comments = [];

  axios.post = async (_url, _body, options) => {
    comments.push(options.params.text);
    return { data: {} };
  };
  t.after(() => {
    axios.post = originalPost;
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

  const log = (body) =>
    fetch(`http://127.0.0.1:${port}/api/log-entry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cardId: "stop-card",
        lat: 37.5205,
        lng: 23.4113,
        timestamp: "2026-08-05T09:00:00.000Z",
        ...body,
      }),
    });

  const waterTankResponse = await log({ action: "water-tank-change" });
  assert.equal(waterTankResponse.status, 200);
  assert.match(comments[0], /^Water Tank Change\n/);

  const otherResponse = await log({
    action: "other",
    customText: "  Changed   the impeller  ",
  });
  assert.equal(otherResponse.status, 200);
  assert.match(comments[1], /^Other: Changed the impeller\n/);

  const emptyOtherResponse = await log({ action: "other", customText: " " });
  assert.equal(emptyOtherResponse.status, 400);
  assert.deepEqual(await emptyOtherResponse.json(), {
    error: "Please describe what happened",
  });
  assert.equal(comments.length, 2);
});

test("logs temperature in the historical degree format", async (t) => {
  const originalPost = axios.post;
  const comments = [];

  axios.post = async (_url, _body, options) => {
    comments.push(options.params.text);
    return { data: {} };
  };
  t.after(() => {
    axios.post = originalPost;
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

  const log = (temperature) =>
    fetch(`http://127.0.0.1:${port}/api/log-entry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "temperature",
        temperature,
        cardId: "stop-card",
        lat: 37.5205,
        lng: 23.4113,
        timestamp: "2026-08-05T09:00:00.000Z",
      }),
    });

  const response = await log(27.8);
  assert.equal(response.status, 200);
  assert.match(comments[0], /^27\.8°\n/);

  const missingResponse = await log("");
  assert.equal(missingResponse.status, 400);
  assert.deepEqual(await missingResponse.json(), {
    error: "Missing or invalid temperature",
  });
  assert.equal(comments.length, 1);
});

test("adds an optional temperature to an arrival log", async (t) => {
  const originalPost = axios.post;
  const originalPut = axios.put;
  const originalGet = axios.get;
  const comments = [];

  axios.post = async (_url, _body, options) => {
    if (options?.params?.text) comments.push(options.params.text);
    return { data: {} };
  };
  axios.put = async () => ({ data: {} });
  axios.get = async () => ({ data: [] });
  t.after(() => {
    axios.post = originalPost;
    axios.put = originalPut;
    axios.get = originalGet;
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

  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, "127.0.0.1", () =>
      resolve(listeningServer),
    );
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/log-entry`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "arrived",
        temperature: 27.8,
        cardId: "stop-card",
        lat: 37.5205,
        lng: 23.4113,
        timestamp: "2026-08-05T09:00:00.000Z",
      }),
    },
  );

  assert.equal(response.status, 200);
  assert.match(comments[0], /^Arrived\n/);
  assert.match(comments[0], /\ntemperature: 27\.8$/);
});

test("keeps the current stop description private and lets a logged-in user update it", async (t) => {
  invalidateBoardCache();
  const originalGet = axios.get;
  const originalPut = axios.put;
  const updates = [];
  const board = {
    members: [{ id: "test-member", memberType: "normal" }],
    lists: [{ id: "list-1", name: "Saronic Gulf" }],
    cards: [
      {
        id: "stop-card",
        idList: "list-1",
        name: "Poros",
        desc: "A quiet anchorage near town.",
        labels: [],
        customFieldItems: [
          { idCustomField: "latitude", value: { number: "37.5" } },
          { idCustomField: "longitude", value: { number: "23.4" } },
        ],
      },
    ],
    customFields: [
      { id: "latitude", name: "Latitude" },
      { id: "longitude", name: "Longitude" },
      { id: "rating", name: "⭐️" },
      { id: "navily", name: "Navily" },
      { id: "dms", name: "DMS", type: "text" },
    ],
  };
  const comments = [
    {
      type: "commentCard",
      date: "2026-08-05T10:00:00.000Z",
      data: {
        card: { id: "stop-card" },
        text: [
          "27.8°",
          "timestamp: 2026-08-05T10:00:00.000Z",
          "lat: 37.5",
          "lng: 23.4",
        ].join("\n"),
      },
    },
    {
      type: "commentCard",
      date: "2026-08-05T09:00:00.000Z",
      data: {
        card: { id: "stop-card" },
        text: [
          "Arrived",
          "timestamp: 2026-08-05T09:00:00.000Z",
          "lat: 37.5",
          "lng: 23.4",
          "mooring: Long lines",
        ].join("\n"),
      },
    },
    {
      type: "commentCard",
      date: "2025-07-01T09:00:00.000Z",
      data: {
        card: { id: "stop-card" },
        text: [
          "Visited",
          "timestamp: 2025-07-01T09:00:00.000Z",
          "lat: 37.5",
          "lng: 23.4",
        ].join("\n"),
      },
    },
  ];

  axios.get = async (url) => ({
    data: String(url).includes("/actions?") ? comments : board,
  });
  axios.put = async (url, body, options) => {
    updates.push({ url, body, options });
    return { data: {} };
  };
  t.after(() => {
    axios.get = originalGet;
    axios.put = originalPut;
    invalidateBoardCache();
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.get("x-test-user")) {
      req.user = {
        id: "test-member",
        token: "test-token",
        tokenSecret: "test-token-secret",
      };
    }
    next();
  });
  app.use(captainsLog);
  const server = await new Promise((resolve) => {
    const listeningServer = app.listen(0, "127.0.0.1", () =>
      resolve(listeningServer),
    );
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/current-stop`,
  );
  const status = await response.json();

  assert.equal(response.status, 200);
  assert.equal(status.status, "arrived");
  assert.equal(status.temperature, 27.8);
  assert.equal(status.mooring, "Long lines");
  assert.equal(status.visitCount, 2);
  assert.equal(Object.hasOwn(status.current, "desc"), false);
  assert.equal(response.headers.get("cache-control"), "public, max-age=30");
  assert.equal(response.headers.get("vary"), "Cookie");

  const authenticatedResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/api/current-stop`,
    { headers: { "x-test-user": "yes" } },
  );
  const authenticatedStatus = await authenticatedResponse.json();

  assert.equal(authenticatedResponse.status, 200);
  assert.equal(
    authenticatedStatus.current.desc,
    "A quiet anchorage near town.",
  );
  assert.equal(
    authenticatedResponse.headers.get("cache-control"),
    "private, max-age=30",
  );

  const updateResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/api/current-stop/description`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-test-user": "yes",
      },
      body: JSON.stringify({ description: "Sheltered, with good holding." }),
    },
  );
  const updateResult = await updateResponse.json();

  assert.equal(updateResponse.status, 200);
  assert.equal(updateResult.description, "Sheltered, with good holding.");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].url, "https://api.trello.com/1/cards/stop-card");
  assert.deepEqual(updates[0].options.params, {
    desc: "Sheltered, with good holding.",
  });

  const editResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/api/current-stop`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-test-user": "yes",
      },
      body: JSON.stringify({
        name: "Poros Town",
        description: "Close to the quay.",
        lat: 37.51,
        lng: 23.41,
      }),
    },
  );
  const editResult = await editResponse.json();

  assert.equal(editResponse.status, 200);
  assert.equal(editResult.place.name, "Poros Town");
  assert.equal(editResult.place.lat, 37.51);
  assert.equal(editResult.dms, `37\u00b0 30' 36" N, 23\u00b0 24' 36" E`);
  assert.equal(updates.length, 3);
  assert.deepEqual(updates[1].options.params, {
    name: "Poros Town",
    desc: "Close to the quay.",
  });
  assert.equal(
    updates[2].url,
    "https://api.trello.com/1/cards/stop-card/customField/dms/item",
  );
  assert.deepEqual(updates[2].body, {
    value: { text: `37\u00b0 30' 36" N, 23\u00b0 24' 36" E` },
  });

  const unauthenticatedUpdate = await fetch(
    `http://127.0.0.1:${server.address().port}/api/current-stop/description`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Nope" }),
    },
  );
  assert.equal(unauthenticatedUpdate.status, 403);
  assert.equal(updates.length, 3);
});
