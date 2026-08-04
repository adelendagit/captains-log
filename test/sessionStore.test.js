const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const session = require("express-session");
const {
  SESSION_TTL_SECONDS,
  createSessionStore,
} = require("../services/sessionStore");

test("treats a missing session file as an expired session without retries", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "captains-log-session-test-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const runtime = createSessionStore(session, { directory, redisUrl: "" });
  const { store } = runtime;
  assert.equal(runtime.kind, "file");
  assert.equal(store.options.ttl, SESSION_TTL_SECONDS);
  assert.equal(store.options.retries, 0);

  const value = await new Promise((resolve, reject) => {
    store.get("missing-session", (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });

  assert.equal(value, null);
});

test("reads an existing login after the session store is recreated", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "captains-log-session-restart-test-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const sessionId = "persisted-login";
  const original = {
    cookie: { maxAge: SESSION_TTL_SECONDS * 1000 },
    passport: { user: { id: "trello-member" } },
  };
  const firstStore = createSessionStore(session, {
    directory,
    redisUrl: "",
  }).store;
  await new Promise((resolve, reject) => {
    firstStore.set(sessionId, original, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const restartedStore = createSessionStore(session, {
    directory,
    redisUrl: "",
  }).store;
  const restored = await new Promise((resolve, reject) => {
    restartedStore.get(sessionId, (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });

  assert.equal(restored.passport.user.id, "trello-member");
});

test("selects Redis and waits for the client connection when REDIS_URL is set", async () => {
  const calls = [];
  const client = {
    isOpen: false,
    on(event) {
      calls.push(`on:${event}`);
    },
    async connect() {
      calls.push("connect");
    },
    async ping() {
      calls.push("ping");
      return "PONG";
    },
  };

  const runtime = createSessionStore(session, {
    redisClient: client,
    redisUrl: "redis://example.invalid:6379",
  });

  assert.equal(runtime.kind, "redis");
  assert.equal(runtime.store.prefix, "captains-log:session:");
  await runtime.ready;
  assert.deepEqual(calls, ["on:error", "connect", "ping"]);
});
