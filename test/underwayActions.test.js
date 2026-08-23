const test = require("node:test");
const assert = require("node:assert/strict");

const { nextDestinationDue } = require("../public/js/underway-actions.js");

test("an underway destination is scheduled before the existing route", () => {
  const now = new Date("2026-08-23T12:00:00.000Z");
  const due = nextDestinationDue(
    [
      {
        id: "plan-1",
        placeId: "existing-destination",
        due: "2026-08-23T11:00:00.000Z",
        dueComplete: false,
      },
    ],
    "new-destination",
    now,
  );

  assert.equal(due.toISOString(), "2026-08-23T10:59:00.000Z");
});

test("rescheduling a later planned place ignores its old due date", () => {
  const now = new Date("2026-08-23T12:00:00.000Z");
  const due = nextDestinationDue(
    [
      {
        id: "plan-1",
        placeId: "current-destination",
        due: "2026-08-24T09:00:00.000Z",
        dueComplete: false,
      },
      {
        id: "plan-2",
        placeId: "selected-place",
        due: "2026-08-25T09:00:00.000Z",
        dueComplete: false,
      },
    ],
    "selected-place",
    now,
  );

  assert.equal(due.toISOString(), now.toISOString());
});

test("a route with no other stops uses the current time", () => {
  const now = new Date("2026-08-23T12:00:00.000Z");
  assert.equal(
    nextDestinationDue([], "new-destination", now).toISOString(),
    now.toISOString(),
  );
});
