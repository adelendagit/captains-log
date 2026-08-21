const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const axios = require("axios");

const settingsDirectory = path.join(
  os.tmpdir(),
  `captains-log-todo-test-${process.pid}`,
);
process.env.TODO_SETTINGS_PATH = path.join(settingsDirectory, "settings.json");
process.env.TRELLO_BOARD_ID = "todo-board";
process.env.TRELLO_KEY = "todo-key";
process.env.TRELLO_TOKEN = "todo-token";

const todo = require("../routes/todo");

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: "captain" };
    next();
  });
  app.use(todo);
  app.use((error, _req, res, _next) => {
    res.status(500).json({ error: error.message });
  });
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("to-do settings select which open board lists are available", async (t) => {
  await fs.rm(settingsDirectory, { recursive: true, force: true });
  const originalGet = axios.get;
  const originalPut = axios.put;
  let restored = false;
  axios.get = async (url) => {
    if (String(url).includes("/members/me/boards")) {
      return {
        data: [
          {
            id: "todo-board",
            name: "Captain's Log",
            lists: [
              { id: "shopping", name: "Shopping", pos: 1 },
              { id: "today", name: "Today", pos: 2 },
              { id: "later", name: "Later", pos: 3 },
            ],
          },
          {
            id: "home-board",
            name: "Home",
            lists: [{ id: "home-jobs", name: "Jobs", pos: 1 }],
          },
        ],
      };
    }
    if (String(url).includes("/cards/shopping-card")) {
      return {
        data: {
          id: "shopping-card",
          idList: "shopping",
          closed: false,
          dueComplete: true,
        },
      };
    }
    if (String(url).includes("/lists/home-jobs/cards")) return { data: [] };
    throw new Error(`Unexpected Trello request: ${url}`);
  };
  axios.put = async (url) => {
    if (String(url).includes("/cards/shopping-card")) {
      restored = true;
      return { data: {} };
    }
    throw new Error(`Unexpected Trello update: ${url}`);
  };
  t.after(async () => {
    axios.get = originalGet;
    axios.put = originalPut;
    await fs.rm(settingsDirectory, { recursive: true, force: true });
  });

  const server = await startServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseURL = `http://127.0.0.1:${server.address().port}`;

  const initialResponse = await fetch(`${baseURL}/api/settings`);
  const initial = await initialResponse.json();
  assert.equal(initialResponse.status, 200);
  assert.deepEqual(initial.selectedListIds, ["shopping", "today"]);
  assert.deepEqual(
    initial.boards.map((board) => board.id),
    ["todo-board", "home-board"],
  );
  assert.deepEqual(
    initial.boards[1].lists.map((list) => list.id),
    ["home-jobs"],
  );
  assert.deepEqual(
    initial.lists.map((list) => list.id),
    ["shopping", "today", "later", "home-jobs"],
  );

  const updateResponse = await fetch(`${baseURL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listIds: ["home-jobs"] }),
  });
  assert.equal(updateResponse.status, 200);

  const dataResponse = await fetch(`${baseURL}/api/data`);
  const data = await dataResponse.json();
  assert.equal(dataResponse.status, 200);
  assert.deepEqual(
    data.lists.map((list) => list.id),
    ["home-jobs"],
  );
  assert.equal(data.lists[0].boardName, "Home");

  const restoreResponse = await fetch(`${baseURL}/shopping-card/completion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ complete: false }),
  });
  assert.equal(restoreResponse.status, 200);
  assert.equal(restored, true);
});

test("to-do settings require at least one valid list", async (t) => {
  await fs.rm(settingsDirectory, { recursive: true, force: true });
  const originalGet = axios.get;
  axios.get = async () => ({
    data: [
      {
        id: "todo-board",
        name: "Captain's Log",
        lists: [{ id: "today", name: "Today", pos: 1 }],
      },
    ],
  });
  t.after(async () => {
    axios.get = originalGet;
    await fs.rm(settingsDirectory, { recursive: true, force: true });
  });
  const server = await startServer();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseURL = `http://127.0.0.1:${server.address().port}`;

  const emptyResponse = await fetch(`${baseURL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listIds: [] }),
  });
  assert.equal(emptyResponse.status, 400);

  const unknownResponse = await fetch(`${baseURL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listIds: ["unknown"] }),
  });
  assert.equal(unknownResponse.status, 400);
});
