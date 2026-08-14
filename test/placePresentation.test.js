const assert = require("node:assert/strict");
const test = require("node:test");
const { buildPlacePresentation, placeIconKind } = require("../services/places");

test("builds one cross-platform presentation for mooring places", () => {
  const place = {
    labels: [
      { name: "Buoy and lazy line", trelloColor: "orange", color: "#ff9f1a" },
    ],
  };

  assert.deepEqual(buildPlacePresentation(place), {
    icon: "mooring",
    iosSystemImage: "lifepreserver.fill",
    webIconClass: "fa-life-ring",
    mooringSummary: "Buoy and lazy line",
  });
});

test("classifies marina and anchorage labels consistently", () => {
  assert.equal(
    placeIconKind({
      labels: [{ name: "Marina berth", trelloColor: "orange" }],
    }),
    "marina",
  );
  assert.equal(
    placeIconKind({ labels: [{ name: "Anchorage", trelloColor: "orange" }] }),
    "anchor",
  );
  assert.equal(placeIconKind({ labels: [] }), "place");
});
