// public/js/captains-log.js

// Haversine → meters
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = lat1 * Math.PI/180, φ2 = lat2 * Math.PI/180;
  const dφ = (lat2 - lat1) * Math.PI/180;
  const dλ = (lon2 - lon1) * Math.PI/180;
  const a = Math.sin(dφ/2)**2 +
            Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function toNM(m) { return m/1852; }
function formatDuration(h) {
  const hh = Math.floor(h), mm = Math.round((h - hh)*60);
  return `${hh}h ${mm}m`;
}

async function fetchData() {
  const res = await fetch('/api/data');
  return res.json();
}

// map rating 1–5 → color
function getColorForRating(r) {
  if (r == null)       return '#888888'; // gray
  if (r <= 1)          return '#d73027';
  if (r <= 2)          return '#fc8d59';
  if (r <= 3)          return '#fee08b';
  if (r <= 4)          return '#d9ef8b';
  return '#1a9850';     // 5
}

// helper to decide badge text‑color based on background
function badgeTextColor(bg) {
  const light = ['yellow','lime','pink','orange','sky'];
  return light.includes(bg) ? '#000' : '#fff';
}

// helper to build a 5‑star string from 1–5
function makeStars(n) {
  if (n == null) return '';
  const full = '★'.repeat(n);
  const empty = '☆'.repeat(5 - n);
  return full + empty;
}

function initMap(stops, places) {
  const map = L.map('map').setView([0,0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
    .addTo(map);

  const stopCoords = [];

  // plot planned stops only
  stops.forEach(s => {
    const ll = [s.lat, s.lng];
    stopCoords.push(ll);

    // choose color: blue for current, else by rating
    const color = s.dueComplete
      ? '#3182bd'
      : getColorForRating(s.rating);

      console.log(`Stop "${s.name}" rating=${s.rating} → color=${color}`);

    L.circleMarker(ll, {
      radius: 7,
      fillColor:   color,
      color:       '#000',
      weight:      1,
      fillOpacity: 0.8
    })
    .addTo(map)
    .bindPopup(
      `<strong>${s.dueComplete ? 'Current:' : ''} ${s.name}</strong><br>` +
      (s.dueComplete
        ? ''
        : `${new Date(s.due).toLocaleDateString()}<br>` +
          `Rating: ${s.rating ?? '–'}/5`
      )
    );
  });

  // fit to stops only
  if (stopCoords.length) {
    map.fitBounds(stopCoords, { padding: [40, 40] });
  }

  // plot other places without changing zoom
  places.forEach(p => {
    const ll = [p.lat, p.lng];
    const color = getColorForRating(p.rating);
    L.circleMarker(ll, {
      radius: 6,
      fillColor:   color,
      color:       '#000',
      weight:      1,
      fillOpacity: 0.5
    })
    .addTo(map)
    .bindPopup(
      `<strong>${p.name}</strong><br>` +
      `Rating: ${p.rating ?? '–'}/5`
    );
  });
}


function renderList(stops, speed) {
  const listEl = document.getElementById('planning-list');
  listEl.innerHTML = '';

  // 1) Render current location (dueComplete === true)
  const current = stops.find(s => s.dueComplete);
  if (current) {
    const li = document.createElement('li');
    li.className = 'stop-card';
    li.onclick = () => window.open(current.trelloUrl, '_blank');

    // badges for any Trello labels
    const labels = Array.isArray(current.labels) ? current.labels : [];
    const badges = labels
      .map(l => {
        const bg = l.color || '#888';
        const fg = badgeTextColor(bg);
        return `<span class="label" style="background:${bg};color:${fg}">${l.name}</span>`;
      })
      .join('');

    // star‑rating
    const stars = makeStars(current.rating);
    const ratingHtml = stars ? `<div class="rating">${stars}</div>` : '';

    li.innerHTML = `
      <div class="header">${badges}</div>
      <h4>Current: ${current.name}</h4>
      <div class="subtitle">${current.listName}</div>
      ${ratingHtml}
      <div class="links">
        <a href="${current.trelloUrl}" target="_blank">Trello</a>
      </div>
    `;
    listEl.appendChild(li);
  }

  // 2) Group all future stops by calendar day
  const future = stops.filter(s => !s.dueComplete);
  const byDay = future.reduce((acc, s) => {
    const day = s.due.slice(0,10); // "YYYY-MM-DD"
    (acc[day] ??= []).push(s);
    return acc;
  }, {});

  // 3) Iterate each day in order
  Object.keys(byDay).sort().forEach(dayKey => {
    // Day header
    const dateHeader = document.createElement('h3');
    dateHeader.textContent = new Date(dayKey).toLocaleDateString();
    listEl.appendChild(dateHeader);

    // Stops for that day
    byDay[dayKey].forEach((s, idx, arr) => {
      // A) compute distance & ETA from previous point
      const prev = idx === 0
        ? current || null
        : arr[idx - 1];
      let infoHtml = '';
      if (prev) {
        const meters = haversine(prev.lat, prev.lng, s.lat, s.lng);
        const nm     = toNM(meters);
        const eta    = formatDuration(nm / speed);
        infoHtml = `<em>${nm.toFixed(1)} NM, ETA: ${eta}</em>`;
      }

      // B) badges for labels (safe fallback)
      const labels = Array.isArray(s.labels) ? s.labels : [];
      const badges = labels
        .map(l => {
          const bg = l.color || '#888';
          const fg = badgeTextColor(bg);
          return `<span class="label" style="background:${bg};color:${fg}">${l.name}</span>`;
        })
        .join('');

      // C) star‑rating
      const stars = makeStars(s.rating);
      const ratingHtml = stars ? `<div class="rating">${stars}</div>` : '';

      // D) build the card
      const li = document.createElement('li');
      li.className = 'stop-card';
      li.onclick   = () => window.open(s.trelloUrl, '_blank');

      li.innerHTML = `
        <div class="header">${badges}</div>
        <h4>${s.name}</h4>
        <div class="subtitle">${s.listName}</div>
        ${ratingHtml}
        <div class="info">${infoHtml}</div>
        <div class="links">
          <a href="${s.trelloUrl}"  target="_blank">Trello</a>
          ${s.navilyUrl
            ? `<a href="${s.navilyUrl}" target="_blank">Navily</a>`
            : ''}
        </div>
      `;
      listEl.appendChild(li);
    });
  });
}


function initTabs() {
  document.querySelectorAll('.tab-nav button').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.tab-nav button')
        .forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tab-content')
        .forEach(s=>s.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab)
        .classList.remove('hidden');
    });
  });
}

async function init() {
  const { stops, places } = await fetchData();    // server has already excluded Trips
  console.log('Planned stops:', stops);

  const speedInput = document.getElementById('speed-input');
  initMap(stops, places);
  renderList(stops, parseFloat(speedInput.value));

  speedInput.addEventListener('input', () => {
    renderList(stops, parseFloat(speedInput.value) || 0);
  });

  initTabs();
}



document.addEventListener('DOMContentLoaded', init);
