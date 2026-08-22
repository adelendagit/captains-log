/* global module */

(function exposeMapSelection(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CaptainsLogMapSelection = api;
})(typeof globalThis === "object" ? globalThis : this, function mapSelection() {
  const DEFAULT_EMPTY_PLAN_RADIUS_NM = 10;

  function hasCoordinates(place) {
    return Number.isFinite(place?.lat) && Number.isFinite(place?.lng);
  }

  function isUpcomingStop(stop) {
    return Boolean(!stop?.dueComplete && stop?.due && hasCoordinates(stop));
  }

  function hasUpcomingStops(stops = []) {
    return stops.some(isUpcomingStop);
  }

  function showSavedPlacesByDefault(stops = []) {
    return !hasUpcomingStops(stops);
  }

  function markerRating(rating) {
    if (!Number.isFinite(rating)) return null;
    return Math.min(5, Math.max(1, Math.round(rating)));
  }

  return {
    DEFAULT_EMPTY_PLAN_RADIUS_NM,
    hasCoordinates,
    hasUpcomingStops,
    isUpcomingStop,
    markerRating,
    showSavedPlacesByDefault,
  };
});
