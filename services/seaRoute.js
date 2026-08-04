const { findRoute } = require("@ssroute/typescript");

const MAX_ROUTE_POINTS = 250;
const MAX_CACHED_SEGMENTS = 2000;
const segmentCache = new Map();

function isValidPoint(point) {
  return (
    point &&
    Number.isFinite(point.lat) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    Number.isFinite(point.lng) &&
    point.lng >= -180 &&
    point.lng <= 180
  );
}

function segmentKey(from, to) {
  return [from.lat, from.lng, to.lat, to.lng]
    .map((value) => value.toFixed(6))
    .join(",");
}

function cacheSegment(key, coordinates) {
  if (segmentCache.size >= MAX_CACHED_SEGMENTS) {
    const oldestKey = segmentCache.keys().next().value;
    segmentCache.delete(oldestKey);
  }
  segmentCache.set(key, coordinates);
}

function routeSegment(from, to) {
  const key = segmentKey(from, to);
  if (segmentCache.has(key)) return segmentCache.get(key);

  let coordinates = [];
  try {
    const result = findRoute(
      { lat: from.lat, lon: from.lng },
      { lat: to.lat, lon: to.lng },
    );
    const candidate = result?.route?.coordinates;
    if (
      Array.isArray(candidate) &&
      candidate.length > 1 &&
      candidate.every(
        (coordinate) =>
          Array.isArray(coordinate) &&
          coordinate.length >= 2 &&
          Number.isFinite(coordinate[0]) &&
          Number.isFinite(coordinate[1]),
      )
    ) {
      coordinates = candidate.map(([lng, lat]) => [lng, lat]);
    }
  } catch (_error) {
    // Missing maritime-network coverage should leave a gap, not a line over land.
  }

  cacheSegment(key, coordinates);
  return coordinates;
}

function buildSeaRoute(points) {
  if (!Array.isArray(points) || points.length < 2) return [];
  if (points.length > MAX_ROUTE_POINTS || !points.every(isValidPoint)) {
    const error = new Error("Invalid sea-route points");
    error.status = 400;
    throw error;
  }

  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const coordinates = routeSegment(points[index - 1], points[index]);
    if (coordinates.length > 1) segments.push(coordinates);
  }
  return segments;
}

module.exports = { MAX_ROUTE_POINTS, buildSeaRoute, isValidPoint };
