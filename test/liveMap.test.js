const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildJourneyModel,
  buildJourneyViewport,
  runForCurrentMap,
} = require("../public/js/live-map");

test("builds a live-map model from a replayed GPS journey", () => {
  const journey = {
    active: true,
    journey: { name: "[TEST] Channel Rock Bay → Church Area" },
    position: {
      timestamp: "2026-08-21T14:49:49.000Z",
      lat: 37.49779330318069,
      lng: 23.45579491737837,
    },
    track: [
      { lat: 37.52383784735562, lng: 23.42585633195702 },
      { lat: 37.510342, lng: 23.441205 },
      { lat: 37.49779330318069, lng: 23.45579491737837 },
    ],
  };

  assert.deepEqual(buildJourneyModel(journey), {
    position: journey.position,
    trackCoordinates: [
      [37.52383784735562, 23.42585633195702],
      [37.510342, 23.441205],
      [37.49779330318069, 23.45579491737837],
    ],
  });
});

test("does not render inactive journeys or invalid positions", () => {
  assert.equal(buildJourneyModel({ active: false }), null);
  assert.equal(
    buildJourneyModel({
      active: true,
      position: { lat: 91, lng: 23.4 },
      track: [],
    }),
    null,
  );
});

test("fits an active journey around the current position and destination", () => {
  const journey = {
    active: true,
    position: { lat: 37.4978, lng: 23.4558 },
    track: [],
  };
  const destination = { lat: 37.5854, lng: 23.4302 };

  assert.deepEqual(buildJourneyViewport(journey, destination), [
    [37.4978, 23.4558],
    [37.5854, 23.4302],
  ]);
});

test("falls back to the current position when a destination is unavailable", () => {
  const journey = {
    active: true,
    position: { lat: 37.4978, lng: 23.4558 },
    track: [],
  };

  assert.deepEqual(buildJourneyViewport(journey, { lat: null, lng: null }), [
    [37.4978, 23.4558],
  ]);
  assert.equal(buildJourneyViewport({ active: false }, null), null);
});

test("ignores delayed layout work for a removed Leaflet map", () => {
  const removedMap = { id: "removed" };
  const currentMap = { id: "current" };
  let layoutRuns = 0;

  assert.equal(
    runForCurrentMap(removedMap, () => currentMap, () => {
      layoutRuns += 1;
    }),
    false,
  );
  assert.equal(layoutRuns, 0);

  assert.equal(
    runForCurrentMap(currentMap, () => currentMap, () => {
      layoutRuns += 1;
    }),
    true,
  );
  assert.equal(layoutRuns, 1);
});
