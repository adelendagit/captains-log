const booleanDisjoint = require("@turf/boolean-disjoint").default;
const bboxClip = require("@turf/bbox-clip").default;
const distance = require("@turf/distance").default;
const shortestPath = require("@turf/shortest-path").default;

const MAX_PLANNING_POINTS = 50;
const MAX_CACHED_ROUTES = 500;
const routeCache = new Map();
let indexedLandPolygons = null;

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

function coordinateBounds(
  coordinates,
  bounds = [Infinity, Infinity, -Infinity, -Infinity],
) {
  if (typeof coordinates?.[0] === "number") {
    bounds[0] = Math.min(bounds[0], coordinates[0]);
    bounds[1] = Math.min(bounds[1], coordinates[1]);
    bounds[2] = Math.max(bounds[2], coordinates[0]);
    bounds[3] = Math.max(bounds[3], coordinates[1]);
    return bounds;
  }
  for (const child of coordinates || []) coordinateBounds(child, bounds);
  return bounds;
}

function getIndexedLandPolygons() {
  if (indexedLandPolygons) return indexedLandPolygons;
  const land = require("@geo-maps/countries-land-1km")();
  indexedLandPolygons = [];
  for (const feature of land.features) {
    const polygons =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
    for (const coordinates of polygons) {
      indexedLandPolygons.push({
        bounds: coordinateBounds(coordinates),
        feature: {
          type: "Feature",
          properties: feature.properties,
          geometry: { type: "Polygon", coordinates },
        },
      });
    }
  }
  return indexedLandPolygons;
}

function intersectsBounds(left, right) {
  return (
    left[0] <= right[2] &&
    left[2] >= right[0] &&
    left[1] <= right[3] &&
    left[3] >= right[1]
  );
}

function routeBounds(from, to) {
  const lngSpan = Math.abs(to.lng - from.lng);
  const latSpan = Math.abs(to.lat - from.lat);
  const margin = Math.min(
    0.5,
    Math.max(0.04, Math.max(lngSpan, latSpan) * 0.3),
  );
  return [
    Math.min(from.lng, to.lng) - margin,
    Math.min(from.lat, to.lat) - margin,
    Math.max(from.lng, to.lng) + margin,
    Math.max(from.lat, to.lat) + margin,
  ];
}

function lineFeature(from, to) {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: [
        [from.lng, from.lat],
        [to.lng, to.lat],
      ],
    },
  };
}

function routeDistanceNm(coordinates) {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += distance(coordinates[index - 1], coordinates[index], {
      units: "nauticalmiles",
    });
  }
  return total;
}

function resolutionKm(directDistanceNm) {
  if (directDistanceNm <= 5) return 0.5;
  if (directDistanceNm <= 20) return 0.75;
  if (directDistanceNm <= 60) return 1;
  return 1.5;
}

function cacheRoute(key, route) {
  if (routeCache.size >= MAX_CACHED_ROUTES) {
    routeCache.delete(routeCache.keys().next().value);
  }
  routeCache.set(key, route);
}

function routeLeg(from, to) {
  const key = [from.lat, from.lng, to.lat, to.lng]
    .map((value) => value.toFixed(5))
    .join(",");
  if (routeCache.has(key)) return routeCache.get(key);

  const directLine = lineFeature(from, to);
  const directDistanceNm = routeDistanceNm(directLine.geometry.coordinates);
  const bounds = routeBounds(from, to);
  const nearbyLand = getIndexedLandPolygons().filter((polygon) =>
    intersectsBounds(polygon.bounds, bounds),
  );
  const crossesLand = nearbyLand.some(
    (polygon) => !booleanDisjoint(directLine, polygon.feature),
  );

  if (!crossesLand) {
    const route = {
      coordinates: directLine.geometry.coordinates,
      distanceNm: directDistanceNm,
      method: "direct-water",
    };
    cacheRoute(key, route);
    return route;
  }

  try {
    const clippedLand = nearbyLand
      .map((polygon) => bboxClip(polygon.feature, bounds))
      .filter((feature) => feature.geometry.coordinates.length > 0);
    const path = shortestPath([from.lng, from.lat], [to.lng, to.lat], {
      obstacles: { type: "FeatureCollection", features: clippedLand },
      resolution: resolutionKm(directDistanceNm),
      units: "kilometers",
    });
    const coordinates = path.geometry.coordinates;
    if (coordinates.length > 1) {
      const route = {
        coordinates,
        distanceNm: routeDistanceNm(coordinates),
        method: "coastline",
      };
      cacheRoute(key, route);
      return route;
    }
  } catch (_error) {
    // An unresolved leg is returned as unavailable rather than crossing land.
  }

  const unresolved = {
    coordinates: [],
    distanceNm: null,
    method: "unresolved",
  };
  cacheRoute(key, unresolved);
  return unresolved;
}

function buildPlanningRoute(points) {
  if (!Array.isArray(points) || points.length < 2) return { legs: [] };
  if (points.length > MAX_PLANNING_POINTS || !points.every(isValidPoint)) {
    const error = new Error("Invalid planning-route points");
    error.status = 400;
    throw error;
  }

  const legs = [];
  for (let index = 1; index < points.length; index += 1) {
    legs.push(routeLeg(points[index - 1], points[index]));
  }
  return { legs };
}

module.exports = {
  MAX_PLANNING_POINTS,
  buildPlanningRoute,
  isValidPoint,
};
