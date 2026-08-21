const fs = require("node:fs/promises");
const path = require("node:path");
const { createClient } = require("redis");

const SETTINGS_KEY = "captains-log:todo-list-ids";
const settingsPath = path.resolve(
  process.env.TODO_SETTINGS_PATH ||
    path.join(process.cwd(), "data", "todo-settings.json"),
);

let redisClient;
let redisReady;

async function connectedRedis() {
  if (!process.env.REDIS_URL) return null;
  if (!redisClient) {
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on("error", (error) => {
      console.error("[to-do settings] Redis error:", error.message);
    });
    redisReady = redisClient.connect();
  }
  await redisReady;
  return redisClient;
}

async function getTodoListIds() {
  const redis = await connectedRedis();
  if (redis) {
    const value = await redis.get(SETTINGS_KEY);
    return value ? JSON.parse(value) : null;
  }

  try {
    const value = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    return Array.isArray(value.listIds) ? value.listIds : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function setTodoListIds(listIds) {
  const redis = await connectedRedis();
  if (redis) {
    await redis.set(SETTINGS_KEY, JSON.stringify(listIds));
    return;
  }

  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  const temporaryPath = `${settingsPath}.${process.pid}.tmp`;
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify({ listIds }, null, 2)}\n`,
    "utf8",
  );
  await fs.rename(temporaryPath, settingsPath);
}

module.exports = { getTodoListIds, setTodoListIds };
