const {
  buildJourneyHistory,
  findActiveJourney,
  parsePositionComment,
} = require("./journeys");

function positionActionsForJourneys(comments, journeyCards) {
  const journeyIds = new Set(journeyCards.map((card) => card.id));
  return comments
    .filter((action) => journeyIds.has(action.data?.card?.id))
    .map((action) => ({
      journeyId: action.data.card.id,
      position: parsePositionComment(action.data?.text),
    }))
    .filter(({ position }) => position)
    .sort(
      (left, right) =>
        new Date(left.position.timestamp) - new Date(right.position.timestamp),
    );
}

function buildVesselState({
  currentStatus,
  journeyCards = [],
  comments = [],
  now = new Date(),
}) {
  const active = findActiveJourney(journeyCards);
  const positionActions = positionActionsForJourneys(comments, journeyCards);
  const activeActions = active
    ? comments.filter((action) => action.data?.card?.id === active.card.id)
    : [];
  const activeHistory = active
    ? buildJourneyHistory(active.card, activeActions)
    : null;
  const activePosition = activeHistory?.track.at(-1) || null;
  const latestAction = positionActions.at(-1) || null;
  const latestCard = latestAction
    ? journeyCards.find((card) => card.id === latestAction.journeyId)
    : null;

  const journey = active
    ? {
        active: true,
        journey: {
          id: active.card.id,
          name: active.card.name,
          startedAt: active.metadata.startedAt,
        },
        position: activePosition,
        track: activeHistory.track,
      }
    : { active: false };
  const telemetryPosition = activePosition || latestAction?.position || null;

  return {
    state: active ? "underway" : currentStatus?.status || "unknown",
    logbook: currentStatus || { status: "unknown" },
    journey,
    telemetry: telemetryPosition
      ? {
          status: activePosition ? "active" : "last-known",
          position: telemetryPosition,
          observedAt: telemetryPosition.timestamp,
          journey: activePosition
            ? journey.journey
            : latestCard
              ? { id: latestCard.id, name: latestCard.name }
              : null,
        }
      : { status: "none", position: null, observedAt: null, journey: null },
    asOf: new Date(now).toISOString(),
  };
}

module.exports = { buildVesselState };
