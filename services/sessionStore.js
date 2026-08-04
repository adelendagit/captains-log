const path = require("path");
const { RedisStore } = require("connect-redis");
const { createClient } = require("redis");

// Chrome caps persistent cookies at 400 days. Express renews this window on
// every visit, so an active login remains valid indefinitely in practice.
const SESSION_TTL_SECONDS = 400 * 24 * 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;

function createSessionStore(session, options = {}) {
  const redisUrl = options.redisUrl ?? process.env.REDIS_URL;
  if (redisUrl) {
    const client =
      options.redisClient ||
      createClient({
        url: redisUrl,
        socket: {
          connectTimeout: 10_000,
          reconnectStrategy(retries) {
            if (retries >= 10) return new Error("Redis reconnect limit reached");
            return Math.min(100 * 2 ** retries, 3_000);
          },
        },
      });

    client.on?.("error", (error) => {
      console.error("[session] Redis error:", error.message);
    });

    const store = new RedisStore({
      client,
      prefix: "captains-log:session:",
      ttl: SESSION_TTL_SECONDS,
    });
    const ready = client.isOpen
      ? Promise.resolve()
      : client.connect().then(() => client.ping());

    return {
      kind: "redis",
      ready,
      store,
    };
  }

  const FileStore = require("session-file-store")(session);
  const directory = path.resolve(
    options.directory ||
      process.env.SESSION_DIR ||
      path.join(process.cwd(), "sessions"),
  );

  const store = new FileStore({
    path: directory,
    ttl: SESSION_TTL_SECONDS,
    retries: 0,
  });
  const getSession = store.get.bind(store);

  // A cookie can outlive its backing file after a deployment or manual cleanup.
  // Treat that exactly like an expired session instead of surfacing ENOENT as a
  // request error. Other filesystem errors still propagate normally.
  store.get = (sessionId, callback) => {
    getSession(sessionId, (error, value) => {
      if (error?.code === "ENOENT") {
        callback(null, null);
        return;
      }
      callback(error, value);
    });
  };

  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[session] REDIS_URL is not set; using a local file store that will not survive a redeploy.",
    );
  }

  return {
    kind: "file",
    ready: Promise.resolve(),
    store,
  };
}

module.exports = {
  SESSION_TTL_MS,
  SESSION_TTL_SECONDS,
  createSessionStore,
};
