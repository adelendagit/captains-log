const test = require("node:test");
const assert = require("node:assert/strict");
const {
  hasUpcomingStops,
  isUpcomingStop,
  showSavedPlacesByDefault,
} = require("../public/js/map-selection");

test("a completed plan card does not suppress saved places", () => {
  const stops = [
    {
      name: "Church Area",
      due: "2026-08-14T14:00:00.000Z",
      dueComplete: true,
      lat: 37.4981893,
      lng: 23.4561364,
    },
  ];

  assert.equal(hasUpcomingStops(stops), false);
  assert.equal(showSavedPlacesByDefault(stops), true);
});

test("an incomplete located stop keeps the map voyage-focused", () => {
  const stops = [
    {
      name: "Next anchorage",
      due: "2026-08-16T14:00:00.000Z",
      dueComplete: false,
      lat: 37.6,
      lng: 23.5,
    },
  ];

  assert.equal(isUpcomingStop(stops[0]), true);
  assert.equal(hasUpcomingStops(stops), true);
  assert.equal(showSavedPlacesByDefault(stops), false);
});

test("a plan card without usable coordinates is not map-visible", () => {
  const stops = [
    {
      name: "Unlocated stop",
      due: "2026-08-16T14:00:00.000Z",
      dueComplete: false,
      lat: null,
      lng: null,
    },
  ];

  assert.equal(isUpcomingStop(stops[0]), false);
  assert.equal(showSavedPlacesByDefault(stops), true);
});
