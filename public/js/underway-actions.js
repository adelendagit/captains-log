/* global module */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CaptainsLogUnderwayActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MINUTE_MS = 60 * 1000;

  function nextDestinationDue(stops, placeId, now = Date.now()) {
    const nowTime = new Date(now).getTime();
    const earliestOtherDue = (Array.isArray(stops) ? stops : [])
      .filter(
        (stop) =>
          stop &&
          stop.dueComplete !== true &&
          (stop.placeId || stop.id) !== placeId,
      )
      .map((stop) => new Date(stop.due).getTime())
      .filter(Number.isFinite)
      .reduce(
        (earliest, due) =>
          earliest == null || due < earliest ? due : earliest,
        null,
      );

    return new Date(
      earliestOtherDue == null
        ? nowTime
        : Math.min(nowTime, earliestOtherDue - MINUTE_MS),
    );
  }

  return { nextDestinationDue };
});
