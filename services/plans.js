const LEGACY_PLAN_MARKER = "captains-log-plan";

function parseLegacyPlanMetadata(description) {
  const values = {};
  for (const line of String(description || "").split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key && value) values[key] = value;
  }

  if (values[LEGACY_PLAN_MARKER] !== "1" || !values.placecardid) return null;
  return {
    placeCardId: values.placecardid,
    tripCardId: values.tripcardid || null,
    migratedFromDue: values.migratedfromdue || null,
  };
}

function removeLegacyPlanMetadata(description) {
  return String(description || "")
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/^\s*(captains-log-plan|placeCardId|tripCardId|migratedFromDue|Place)\s*:/i.test(
          line,
        ),
    )
    .join("\n")
    .trim();
}

function extractTrelloCardShortLink(value) {
  try {
    const url = new URL(String(value || ""));
    if (!/(^|\.)trello\.com$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/c\/([A-Za-z0-9]+)(?:\/|$)/);
    return match?.[1] || null;
  } catch (_error) {
    return null;
  }
}

function findAttachedPlaceCard(planCard, placeCards = []) {
  const placesByShortLink = new Map(
    placeCards
      .filter((card) => card.shortLink)
      .map((card) => [card.shortLink, card]),
  );
  const matches = new Map();
  for (const attachment of planCard?.attachments || []) {
    const shortLink = extractTrelloCardShortLink(attachment.url);
    const placeCard = placesByShortLink.get(shortLink);
    if (placeCard) matches.set(placeCard.id, placeCard);
  }
  return matches.size === 1 ? [...matches.values()][0] : null;
}

function resolvePlanPlaceCard(planCard, placeCards = []) {
  const attached = findAttachedPlaceCard(planCard, placeCards);
  if (attached) return attached;

  // Temporary compatibility for the two Plan cards created by the first
  // migration. The migration endpoint converts these to attachments and
  // removes the metadata from their descriptions.
  const legacy = parseLegacyPlanMetadata(planCard?.desc);
  return legacy
    ? placeCards.find((card) => card.id === legacy.placeCardId) || null
    : null;
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
  extractTrelloCardShortLink,
  findAttachedPlaceCard,
  findPlanList,
  isReservedList,
  parseLegacyPlanMetadata,
  removeLegacyPlanMetadata,
  resolvePlanPlaceCard,
};
