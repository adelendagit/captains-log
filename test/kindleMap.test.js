const test = require('node:test');
const assert = require('node:assert/strict');
const { renderKindleMap } = require('../services/kindleMap');

test('local map includes coastlines, a centred marker, and nautical scale', () => {
  const svg = renderKindleMap({ lat: '37.49764', lng: '23.45708' });
  assert.match(svg, /<path d="M[0-9]/);
  assert.match(svg, /cx="300" cy="230"/);
  assert.match(svg, />2 nm</);
  assert.doesNotMatch(svg, /NaN|Infinity|<script|<image/);
  assert.match(renderKindleMap({ lat: '37.49764', lng: '23.45708', zoom: 'wide' }), />10 nm</);
});

test('map rejects invalid and missing coordinates', () => {
  for (const query of [{}, { lat: '', lng: '0' }, { lat: 'NaN', lng: '0' },
    { lat: '90', lng: '0' }, { lat: '0', lng: '181' }, { lat: '<script>', lng: '0' }]) {
    assert.throws(() => renderKindleMap(query), { status: 400 });
  }
});
