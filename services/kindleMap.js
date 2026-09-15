const bboxClip = require('@turf/bbox-clip').default;
const { getIndexedLandPolygons } = require('./planningRoute');

function renderKindleMap(query) {
  const lat = Number(query.lat);
  const lng = Number(query.lng);
  const span = query.zoom === 'wide' ? 60 : 12;
  if (typeof query.lat !== 'string' || !query.lat.trim() ||
      typeof query.lng !== 'string' || !query.lng.trim() ||
      !Number.isFinite(lat) || Math.abs(lat) > 85 ||
      !Number.isFinite(lng) || Math.abs(lng) > 180) {
    const error = new Error('Map requires coordinates between 85° S and 85° N.');
    error.status = 400;
    throw error;
  }
  const width = 600;
  const height = 460;
  const dx = span / (60 * Math.cos(lat * Math.PI / 180));
  const dy = span / 60 * height / width;
  const bounds = [lng - dx / 2, lat - dy / 2, lng + dx / 2, lat + dy / 2];
  const paths = [];
  // Shift the world at the date line so nearby coastlines remain visible.
  for (const shift of [-360, 0, 360]) {
    const clip = [bounds[0] - shift, bounds[1], bounds[2] - shift, bounds[3]];
    for (const land of getIndexedLandPolygons()) {
      const b = land.bounds;
      if (b[2] < clip[0] || b[0] > clip[2] || b[3] < clip[1] || b[1] > clip[3]) continue;
      const clipped = bboxClip(land.feature, clip);
      const rings = clipped.geometry.coordinates;
      const path = rings.filter(ring => ring.length).map(ring => ring.map(([x, y], i) =>
        `${i ? 'L' : 'M'}${((x + shift - bounds[0]) / dx * width).toFixed(1)},${((bounds[3] - y) / dy * height).toFixed(1)}`
      ).join(' ') + 'Z').join(' ');
      if (path) paths.push(`<path d="${path}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="460" viewBox="0 0 600 460">
  <rect width="600" height="460" fill="white"/>
  <g fill="#ddd" stroke="black" stroke-width="1.5" fill-rule="evenodd">${paths.join('')}</g>
  <path d="M300 0V460M0 230H600" stroke="#888" stroke-width="1" stroke-dasharray="4 8"/>
  <circle cx="300" cy="230" r="14" fill="white" stroke="black" stroke-width="3"/>
  <circle cx="300" cy="230" r="6" fill="black"/>
  <g font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="black">
  <rect x="14" y="12" width="40" height="64" fill="white"/>
  <text x="26" y="36">N</text><path d="M34 44L26 58H31V70H37V58H42Z"/>
  <rect x="14" y="397" width="132" height="49" fill="white"/>
  <path d="M24 420V430H124V420" fill="none" stroke="black" stroke-width="3"/>
  <text x="24" y="417">${span / 6} nm</text>
  </g></svg>`;
}

module.exports = { renderKindleMap };
