/* global module */

(function exposeLiveMap(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CaptainsLogLiveMap = api;
})(typeof globalThis === "object" ? globalThis : this, function liveMap() {
  function hasCoordinates(point) {
    return (
      Number.isFinite(point?.lat) &&
      point.lat >= -90 &&
      point.lat <= 90 &&
      Number.isFinite(point?.lng) &&
      point.lng >= -180 &&
      point.lng <= 180
    );
  }

  function buildJourneyModel(journey) {
    if (!journey?.active || !hasCoordinates(journey.position)) return null;

    return {
      position: journey.position,
      trackCoordinates: (Array.isArray(journey.track) ? journey.track : [])
        .filter(hasCoordinates)
        .map((point) => [point.lat, point.lng]),
    };
  }

  function runForCurrentMap(map, getCurrentMap, callback) {
    if (!map || map !== getCurrentMap()) return false;
    callback(map);
    return true;
  }

  return { buildJourneyModel, hasCoordinates, runForCurrentMap };
});
