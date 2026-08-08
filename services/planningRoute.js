const booleanDisjoint = require("@turf/boolean-disjoint").default;
const booleanPointInPolygon = require("@turf/boolean-point-in-polygon").default;
const bboxClip = require("@turf/bbox-clip").default;
const distance = require("@turf/distance").default;
const shortestPath = require("@turf/shortest-path").default;
const { point } = require("@turf/helpers");

const detailedGreekLand = require("../data/greece-land-250m.geo.json");

const MAX_PLANNING_POINTS = 50;
const MAX_CACHED_ROUTES = 500;
const MAX_ENDPOINT_SNAP_METERS = 500;
const ROUTE_CLEARANCE_METERS = 30;
const ROUTE_VALIDATION_SPACING_KM = 0.01;
const MAX_ROUTE_LAND_RUN_KM = 0.05;
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
  const land = require("@geo-maps/countries-land-500m")();
  const detailedFeatures = new Map(
    detailedGreekLand.features.map((feature) => [
      feature.properties?.A3,
      feature,
    ]),
  );
  const features = land.features.map(
    (feature) => detailedFeatures.get(feature.properties?.A3) || feature,
  );
  indexedLandPolygons = [];
  for (const feature of features) {
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

function nearbyLandPolygons(bounds) {
  return getIndexedLandPolygons().filter((polygon) =>
    intersectsBounds(polygon.bounds, bounds),
  );
}

function containingLandPolygon(coordinate) {
  const bounds = [coordinate[0], coordinate[1], coordinate[0], coordinate[1]];
  return nearbyLandPolygons(bounds).find((polygon) =>
    booleanPointInPolygon(point(coordinate), polygon.feature),
  );
}

function nearestPointOnRing(coordinate, ring) {
  const latitudeRadians = (coordinate[1] * Math.PI) / 180;
  const metersPerLngDegree = 111_320 * Math.cos(latitudeRadians);
  const metersPerLatDegree = 110_540;
  let nearest = null;

  for (let index = 1; index < ring.length; index += 1) {
    const start = ring[index - 1];
    const end = ring[index];
    const startX = (start[0] - coordinate[0]) * metersPerLngDegree;
    const startY = (start[1] - coordinate[1]) * metersPerLatDegree;
    const endX = (end[0] - coordinate[0]) * metersPerLngDegree;
    const endY = (end[1] - coordinate[1]) * metersPerLatDegree;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const fraction =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(1, -(startX * deltaX + startY * deltaY) / lengthSquared),
          );
    const x = startX + deltaX * fraction;
    const y = startY + deltaY * fraction;
    const distanceMeters = Math.hypot(x, y);

    if (!nearest || distanceMeters < nearest.distanceMeters) {
      nearest = {
        coordinate: [
          start[0] + (end[0] - start[0]) * fraction,
          start[1] + (end[1] - start[1]) * fraction,
        ],
        distanceMeters,
        direction: { x, y },
      };
    }
  }
  return nearest;
}

function snapPointToWater(planningPoint) {
  const coordinate = [planningPoint.lng, planningPoint.lat];
  const containingPolygon = containingLandPolygon(coordinate);
  if (!containingPolygon) {
    return { coordinate, distanceToWaterM: 0, onLand: false, snapped: false };
  }

  let nearest = null;
  for (const ring of containingPolygon.feature.geometry.coordinates) {
    const candidate = nearestPointOnRing(coordinate, ring);
    if (
      candidate &&
      (!nearest || candidate.distanceMeters < nearest.distanceMeters)
    ) {
      nearest = candidate;
    }
  }
  if (!nearest || nearest.distanceMeters > MAX_ENDPOINT_SNAP_METERS) {
    return {
      coordinate: null,
      distanceToWaterM: nearest?.distanceMeters ?? null,
      onLand: true,
      snapped: false,
    };
  }

  const directionLength = Math.hypot(nearest.direction.x, nearest.direction.y);
  if (directionLength === 0) {
    return {
      coordinate: null,
      distanceToWaterM: 0,
      onLand: true,
      snapped: false,
    };
  }
  const latitudeRadians = (coordinate[1] * Math.PI) / 180;
  const metersPerLngDegree = 111_320 * Math.cos(latitudeRadians);
  const metersPerLatDegree = 110_540;
  const unitX = nearest.direction.x / directionLength;
  const unitY = nearest.direction.y / directionLength;

  for (
    let clearanceMeters = ROUTE_CLEARANCE_METERS;
    clearanceMeters <= MAX_ENDPOINT_SNAP_METERS;
    clearanceMeters *= 2
  ) {
    const snappedCoordinate = [
      nearest.coordinate[0] + (unitX * clearanceMeters) / metersPerLngDegree,
      nearest.coordinate[1] + (unitY * clearanceMeters) / metersPerLatDegree,
    ];
    if (!containingLandPolygon(snappedCoordinate)) {
      return {
        coordinate: snappedCoordinate,
        distanceToWaterM: nearest.distanceMeters,
        onLand: true,
        snapped: true,
      };
    }
  }

  return {
    coordinate: null,
    distanceToWaterM: nearest.distanceMeters,
    onLand: true,
    snapped: false,
  };
}

function classifyPlanningPoint(planningPoint) {
  if (!isValidPoint(planningPoint)) {
    return { valid: false, onLand: null, distanceToWaterM: null };
  }
  const snapped = snapPointToWater(planningPoint);
  return {
    valid: true,
    onLand: snapped.onLand,
    distanceToWaterM: snapped.distanceToWaterM,
    routable: Boolean(snapped.coordinate),
    snapped: snapped.snapped,
  };
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

function coordinateLineFeature(from, to) {
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: [from, to] },
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
  if (directDistanceNm <= 5) return 0.1;
  if (directDistanceNm <= 20) return 0.25;
  if (directDistanceNm <= 60) return 0.5;
  return 1;
}

function routeStaysInWater(coordinates, nearbyLand) {
  let landRunKm = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const from = coordinates[index - 1];
    const to = coordinates[index];
    const segmentDistanceKm = distance(from, to, { units: "kilometers" });
    const samples = Math.max(
      1,
      Math.ceil(segmentDistanceKm / ROUTE_VALIDATION_SPACING_KM),
    );
    for (let sample = 0; sample <= samples; sample += 1) {
      const fraction = sample / samples;
      const coordinate = [
        from[0] + (to[0] - from[0]) * fraction,
        from[1] + (to[1] - from[1]) * fraction,
      ];
      const onLand = nearbyLand.some((polygon) =>
        booleanPointInPolygon(point(coordinate), polygon.feature, {
          ignoreBoundary: true,
        }),
      );
      if (onLand) {
        landRunKm += segmentDistanceKm / samples;
      } else {
        landRunKm = 0;
      }
      if (landRunKm > MAX_ROUTE_LAND_RUN_KM) {
        return false;
      }
    }
  }
  return true;
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

  const snappedFrom = snapPointToWater(from);
  const snappedTo = snapPointToWater(to);
  if (!snappedFrom.coordinate || !snappedTo.coordinate) {
    const unresolved = {
      coordinates: [],
      distanceNm: null,
      method: "unresolved",
    };
    cacheRoute(key, unresolved);
    return unresolved;
  }

  const directLine = coordinateLineFeature(
    snappedFrom.coordinate,
    snappedTo.coordinate,
  );
  const directDistanceNm = routeDistanceNm(directLine.geometry.coordinates);
  const safeFrom = {
    lng: snappedFrom.coordinate[0],
    lat: snappedFrom.coordinate[1],
  };
  const safeTo = { lng: snappedTo.coordinate[0], lat: snappedTo.coordinate[1] };
  const bounds = routeBounds(safeFrom, safeTo);
  const nearbyLand = nearbyLandPolygons(bounds);
  const crossesLand = nearbyLand.some(
    (polygon) => !booleanDisjoint(directLine, polygon.feature),
  );

  if (!crossesLand) {
    const route = {
      coordinates: directLine.geometry.coordinates,
      distanceNm: directDistanceNm,
      method: "direct-water",
      snappedEndpoints: snappedFrom.snapped || snappedTo.snapped,
    };
    cacheRoute(key, route);
    return route;
  }

  try {
    const clippedLand = nearbyLand
      .map((polygon) => bboxClip(polygon.feature, bounds))
      .filter((feature) => feature.geometry.coordinates.length > 0);
    const baseResolution = resolutionKm(directDistanceNm);
    for (const resolution of [
      baseResolution,
      baseResolution / 2,
      baseResolution / 4,
    ]) {
      const path = shortestPath(snappedFrom.coordinate, snappedTo.coordinate, {
        obstacles: { type: "FeatureCollection", features: clippedLand },
        resolution,
        units: "kilometers",
      });
      const coordinates = path.geometry.coordinates;
      if (
        coordinates.length > 1 &&
        routeStaysInWater(coordinates, nearbyLand)
      ) {
        const route = {
          coordinates,
          distanceNm: routeDistanceNm(coordinates),
          method: "coastline",
          snappedEndpoints: snappedFrom.snapped || snappedTo.snapped,
        };
        cacheRoute(key, route);
        return route;
      }
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
  classifyPlanningPoint,
  isValidPoint,
};
