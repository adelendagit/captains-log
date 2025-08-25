const { test } = require('node:test');
const assert = require('assert');
const { extractTimestamp } = require('../services/extractTimestamp');

test('parses lowercase prefix', () => {
  const result = extractTimestamp('Arrived timestamp: 2025-07-07 10:30', 'fallback');
  assert.strictEqual(result, '2025-07-07T10:30:00.000Z');
});

test('parses capitalized prefix', () => {
  const result = extractTimestamp('Arrived Timestamp: 2025-07-07 10:30', 'fallback');
  assert.strictEqual(result, '2025-07-07T10:30:00.000Z');
});

test('parses bare timestamp', () => {
  const result = extractTimestamp('Arrived 2025-07-07 10:30', 'fallback');
  assert.strictEqual(result, '2025-07-07T10:30:00.000Z');
});

test('falls back when missing', () => {
  const fallback = '2025-06-01T00:00:00.000Z';
  const result = extractTimestamp('Arrived', fallback);
  assert.strictEqual(result, fallback);
});
