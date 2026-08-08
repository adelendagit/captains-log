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
const { invalidateBoardCache } = require("../services/trello");

async function startTestServer(user) {
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

test("creates a Trello place and populates its location fields", async (t) => {
  invalidateBoardCache();
  const originalGet = axios.get;
  const originalPost = axios.post;
  const originalPut = axios.put;
  const posts = [];
  const puts = [];

  axios.get = async () => ({
    data: {
      cards: [],
      lists: [
        { id: "greece", name: "Greece" },
        { id: "trips", name: "Trips" },
      ],
      customFields: [
        { id: "latitude-field", name: "Latitude", type: "number" },
        { id: "longitude-field", name: "Longitude", type: "number" },
        { id: "navily-field", name: "Navily", type: "text" },
      ],
      members: [{ id: "captain", memberType: "normal" }],
      labels: [],
    },
  });
  axios.post = async (url, body, options) => {
    posts.push({ url, body, options });
    return {
      data: {
        id: "new-place",
        shortUrl: "https://trello.com/c/new-place",
      },
    };
  };
  axios.put = async (url, body, options) => {
    puts.push({ url, body, options });
    return { data: {} };
  };
  t.after(() => {
    axios.get = originalGet;
    axios.post = originalPost;
    axios.put = originalPut;
    invalidateBoardCache();
  });

  const server = await startTestServer({
    id: "captain",
    token: "member-token",
    tokenSecret: "member-secret",
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/places`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Anaktorio",
        description: "Sand holding.",
        listId: "greece",
        lat: 38.9005,
        lng: 21.0212,
        navilyUrl:
          "http://navily.com/mouillage/anaktorio/42264?utm_source=share#reviews",
      }),
    },
  );
  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.place.name, "Anaktorio");
  assert.equal(
    result.place.navilyUrl,
    "https://www.navily.com/mouillage/anaktorio/42264",
  );
  assert.deepEqual(posts[0].options.params, {
    name: "Anaktorio",
    desc: "Sand holding.",
    idList: "greece",
  });
  assert.equal(puts.length, 3);
  assert.deepEqual(puts.map(({ body }) => body), [
    { value: { number: "38.9005" } },
    { value: { number: "21.0212" } },
    {
      value: {
        text: "https://www.navily.com/mouillage/anaktorio/42264",
      },
    },
  ]);
});

test("rejects invalid place input before calling Trello", async (t) => {
  const originalGet = axios.get;
  const originalPost = axios.post;
  let calledTrello = false;
  axios.get = async () => {
    calledTrello = true;
    return { data: {} };
  };
  axios.post = async () => {
    calledTrello = true;
    return { data: {} };
  };
  t.after(() => {
    axios.get = originalGet;
    axios.post = originalPost;
  });

  const server = await startTestServer({
    id: "captain",
    token: "member-token",
    tokenSecret: "member-secret",
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/places`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Not Navily",
        listId: "greece",
        lat: 91,
        lng: 21,
        navilyUrl: "https://example.com/place/1",
      }),
    },
  );
  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.error, "Enter a valid Navily place URL");
  assert.equal(calledTrello, false);
});

test("requires both place coordinates", async (t) => {
  const server = await startTestServer({
    id: "captain",
    token: "member-token",
    tokenSecret: "member-secret",
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/places`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Missing position",
        listId: "greece",
        navilyUrl: "https://www.navily.com/mouillage/example/1",
      }),
    },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Latitude must be between -90 and 90",
  });
});
