const PLAN_MARKER = "captains-log-plan";

function parsePlanMetadata(description) {
  const values = {};
  for (const line of String(description || "").split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key && value) values[key] = value;
  }

  if (values[PLAN_MARKER] !== "1" || !values.placecardid) return null;
  return {
    placeCardId: values.placecardid,
    tripCardId: values.tripcardid || null,
    migratedFromDue: values.migratedfromdue || null,
  };
}

function buildPlanDescription({
  placeCardId,
  placeUrl = null,
  tripCardId = null,
  migratedFromDue = null,
}) {
  const lines = [`${PLAN_MARKER}: 1`, `placeCardId: ${placeCardId}`];
  if (tripCardId) lines.push(`tripCardId: ${tripCardId}`);
  if (migratedFromDue) lines.push(`migratedFromDue: ${migratedFromDue}`);
  if (placeUrl) lines.push("", `Place: ${placeUrl}`);
  return lines.join("\n");
}

function findPlanList(lists = []) {
  return lists.find(
    (list) =>
      String(list.name || "")
        .trim()
        .toLowerCase() === "plan",
  );
}

function isReservedList(list) {
  return ["trips", "journeys", "plan"].includes(
    String(list?.name || "")
      .trim()
      .toLowerCase(),
  );
}

module.exports = {
  buildPlanDescription,
  findPlanList,
  isReservedList,
  parsePlanMetadata,
};
