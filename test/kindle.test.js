const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function display() {
  const elements = {};
  const requests = [];
  const context = {
    document: { getElementById(id) { return elements[id] ||= { style: {}, textContent: '' }; } },
    XMLHttpRequest: function () {
      requests.push(this);
      this.open = () => {};
      this.setRequestHeader = () => {};
      this.send = () => {};
    },
    setInterval() {},
  };
  vm.runInNewContext(fs.readFileSync('public/js/kindle.js', 'utf8'), context);
  function respond(state) {
    const request = requests.at(-1);
    request.status = 200;
    request.responseText = JSON.stringify(state);
    request.onload();
  }
  return { elements, requests, respond, context };
}

test('Kindle script loads externally under the site CSP', () => {
  const html = fs.readFileSync('public/kindle.html', 'utf8');
  assert.match(html, /<script src="\/js\/kindle.js"><\/script>/);
  assert.doesNotMatch(html, /<script>/);
});

test('historical position remains visible without showing motion after arrival', () => {
  const page = display();
  page.respond({ state: 'arrived', logbook: { current: { name: 'Vikos Area' } },
    journey: { active: false }, telemetry: { status: 'last-known', position: {
      lat: 37.49764, lng: 23.45708, speedKts: 2.5127, course: 100.28,
      timestamp: '2026-08-28T06:37:52.000Z',
    } } });
  assert.equal(page.elements.speed.textContent, '—');
  assert.equal(page.elements.course.textContent, '—');
  assert.equal(page.elements.place.textContent, 'Vikos Area');
  assert.equal(page.elements.freshness.textContent, 'Last recorded GPS fix');
  assert.equal(page.elements.coords.textContent, '37.49764° N\n23.45708° E');
});

test('missing telemetry does not become zero coordinates, speed, or course', () => {
  const page = display();
  page.respond({ telemetry: { status: 'none', position: null } });
  assert.equal(page.elements.coords.textContent, 'No GPS position available');
  assert.equal(page.elements.speed.textContent, '—');
  assert.equal(page.elements.course.textContent, '—');
  assert.equal(page.elements.updated.textContent, 'Unknown');
});

test('zero values and southern/western coordinates render correctly', () => {
  const page = display();
  page.respond({ state: 'underway', telemetry: { status: 'active', position: { lat: -1, lng: -2, speedKts: 0, course: 0 } } });
  assert.equal(page.elements.coords.textContent, '1.00000° S\n2.00000° W');
  assert.equal(page.elements.speed.textContent, '0.0 kt');
  assert.equal(page.elements.course.textContent, '0°');
});

test('failed refresh preserves the last position with a warning and recovers', () => {
  const page = display();
  const state = { logbook: { current: { name: 'Vikos Area' } } };
  page.respond(state);
  for (const fail of [() => page.requests[0].onerror(), () => page.requests[0].ontimeout(),
    () => { page.requests[0].status = 500; page.requests[0].onload(); },
    () => { page.requests[0].status = 200; page.requests[0].responseText = '{'; page.requests[0].onload(); }]) {
    fail();
    assert.equal(page.elements.display.style.display, 'block');
    assert.equal(page.elements.place.textContent, 'Vikos Area');
    assert.equal(page.elements.error.style.display, 'block');
    page.respond(state);
    assert.equal(page.elements.error.style.display, 'none');
  }
});

test('motion is shown only for active underway telemetry and clears after arrival', () => {
  const page = display();
  const position = { speedKts: 2.5127, course: 100.28 };
  page.respond({ state: 'underway', telemetry: { status: 'active', position } });
  assert.equal(page.elements.speed.textContent, '2.5 kt');
  assert.equal(page.elements.course.textContent, '100°');
  for (const [state, status] of [['arrived', 'active'], ['arrived', 'last-known'], ['underway', 'last-known']]) {
    page.respond({ state, telemetry: { status, position } });
    assert.equal(page.elements.speed.textContent, '—');
    assert.equal(page.elements.course.textContent, '—');
  }
});
