const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPositionComment,
  parseJourneyDescription,
  parsePositionComment,
} = require("../services/journeys");
const {
  createPairingCode,
  decodeMobileToken,
  exchangePairingCode,
} = require("../services/mobileAuth");
const { buildSeaRoute, isValidPoint } = require("../services/seaRoute");
const { buildPlanningRoute } = require("../services/planningRoute");

test("parses journey metadata stored in a card description", () => {
  assert.deepEqual(
    parseJourneyDescription(
      [
        "captains-log-journey: 1",
        "status: active",
        "startedAt: 2026-08-03T09:00:00.000Z",
        "startedBy: member-1",
      ].join("\n"),
    ),
    {
      status: "active",
      startedAt: "2026-08-03T09:00:00.000Z",
      startedBy: "member-1",
      endedAt: null,
    },
  );
});

test("round trips a structured GPS position comment", () => {
  const position = {
    timestamp: "2026-08-03T09:01:00.000Z",
    lat: 37.9838,
    lng: 23.7275,
    accuracy: 8.2,
    speedKts: 5.4,
    course: 145,
    altitude: 2,
    sampleId: "sample_12345678",
    source: "ios",
  };
  assert.deepEqual(parsePositionComment(buildPositionComment(position)), position);
});

test("rejects malformed position comments", () => {
  assert.equal(
    parsePositionComment(
      "position\ntimestamp: 2026-08-03T09:01:00.000Z\nlat: 120\nlng: 23",
    ),
    null,
  );
});

test("exchanges a pairing code once for an encrypted mobile token", () => {
  const code = createPairingCode({
    id: "member-1",
    displayName: "Captain",
    token: "trello-token",
    tokenSecret: "trello-token-secret",
  });
  const token = exchangePairingCode(code);
  assert.equal(decodeMobileToken(token).id, "member-1");
  assert.equal(exchangePairingCode(code), null);
  assert.equal(decodeMobileToken(`${token}tampered`), null);
});

test("builds display-only maritime segments for historical stops", () => {
  const segments = buildSeaRoute([
    { lat: 37.9383, lng: 23.6238 },
    { lat: 37.4467, lng: 25.3289 },
  ]);
  assert.ok(segments.length > 0);
  assert.ok(segments[0].length > 1);
  assert.ok(segments[0].every(([lng, lat]) => isValidPoint({ lat, lng })));
});

test("rejects invalid historical route points", () => {
  assert.throws(
    () =>
      buildSeaRoute([
        { lat: 37.9, lng: 23.6 },
        { lat: 91, lng: 25.3 },
      ]),
    /Invalid sea-route points/,
  );
});

test("calculates coastline-aware planning distance between nearby stops", () => {
  const route = buildPlanningRoute([
    { lat: 37.52283333333333, lng: 23.426166666666667 },
    { lat: 37.504666666666665, lng: 23.4505 },
  ]);
  assert.equal(route.legs.length, 1);
  assert.equal(route.legs[0].method, "coastline");
  assert.ok(route.legs[0].coordinates.length > 2);
  assert.ok(route.legs[0].distanceNm > 1.5);
  assert.ok(route.legs[0].distanceNm < 4);
});

test("routes Channel Rock Bay to Wasp Bay around the headland", () => {
  const route = buildPlanningRoute([
    { lat: 37.52283333333333, lng: 23.426166666666667 },
    { lat: 37.5205, lng: 23.41133333333333 },
  ]);
  assert.equal(route.legs.length, 1);
  assert.equal(route.legs[0].method, "coastline");
  assert.ok(route.legs[0].coordinates.length > 2);
  assert.ok(route.legs[0].distanceNm > 0.72);
});

test("rejects invalid planning route coordinates", () => {
  assert.throws(
    () =>
      buildPlanningRoute([
        { lat: 37.9, lng: 23.6 },
        { lat: 37.9, lng: 181 },
      ]),
    /Invalid planning-route points/,
  );
});
