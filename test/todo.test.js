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
  axios.get = async (url) => {
    if (String(url).includes("/boards/")) {
      return {
        data: [
          { id: "shopping", name: "Shopping", pos: 1 },
          { id: "today", name: "Today", pos: 2 },
          { id: "later", name: "Later", pos: 3 },
        ],
      };
    }
    if (String(url).includes("/lists/later/cards")) return { data: [] };
    throw new Error(`Unexpected Trello request: ${url}`);
  };
  t.after(async () => {
    axios.get = originalGet;
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
    initial.lists.map((list) => list.id),
    ["shopping", "today", "later"],
  );

  const updateResponse = await fetch(`${baseURL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listIds: ["later"] }),
  });
  assert.equal(updateResponse.status, 200);

  const dataResponse = await fetch(`${baseURL}/api/data`);
  const data = await dataResponse.json();
  assert.equal(dataResponse.status, 200);
  assert.deepEqual(
    data.lists.map((list) => list.id),
    ["later"],
  );
});

test("to-do settings require at least one valid list", async (t) => {
  const originalGet = axios.get;
  axios.get = async () => ({ data: [{ id: "today", name: "Today", pos: 1 }] });
  t.after(() => {
    axios.get = originalGet;
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
