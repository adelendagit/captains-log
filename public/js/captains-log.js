// public/js/captains-log.js

// Haversine → meters
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180,
    φ2 = (lat2 * Math.PI) / 180;
  const dφ = ((lat2 - lat1) * Math.PI) / 180;
  const dλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function toNM(m) {
  return m / 1852;
}
function formatDuration(h) {
  const hh = Math.floor(h),
    mm = Math.round((h - hh) * 60);
  return `${hh}h ${mm}m`;
}

function formatDurationRounded(h) {
  if (!isFinite(h)) return "";
  // Round to nearest 15 minutes
  const totalMinutes = Math.round(h * 60 / 15) * 15;
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  if (hh && mm) return `${hh}h ${mm}m`;
  if (hh) return `${hh}h`;
  return `${mm}m`;
}

async function fetchData() {
  const res = await fetch("/api/data");
  return res.json();
}

// map rating 1–5 → color
function getColorForRating(r) {
  if (r == null) return "#888888"; // gray
  if (r <= 1) return "#d73027";
  if (r <= 2) return "#fc8d59";
  if (r <= 3) return "#fee08b";
  if (r <= 4) return "#d9ef8b";
  return "#1a9850"; // 5
}

// pick legible text color for a background
function badgeTextColor(bg) {
  const hex = bg.replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#000" : "#fff";
}

// build star rating markup
function makeStars(r) {
  if (r == null) return "";
  const full = "★".repeat(Math.round(r));
  const empty = "☆".repeat(5 - Math.round(r));
  return `<span class="stars">${full}${empty}</span>`;
}

function initMap(stops, places) {
  const map = L.map("map").setView([0, 0], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

  const stopCoords = [];

  // plot planned stops only
  stops.forEach((s) => {
    const ll = [s.lat, s.lng];
    stopCoords.push(ll);

    // choose color: blue for current, else by rating
    const color = s.dueComplete ? "#3182bd" : getColorForRating(s.rating);

    L.circleMarker(ll, {
      radius: 7,
      fillColor: color,
      color: "#000",
      weight: 1,
      fillOpacity: 0.8,
    })
      .addTo(map)
      .bindPopup(
        `<strong>${s.dueComplete ? "Current:" : ""} ${s.name}</strong><br>` +
          (s.dueComplete
            ? ""
            : `${new Date(s.due).toLocaleDateString()}<br>` +
              `Rating: ${s.rating ?? "–"}/5`)
      )
      .bindTooltip(s.name, { permanent: true, direction: "right", offset: [10, 0], className: "map-label" });
  });

  // Ensure the map knows its size before fitting bounds
  setTimeout(() => {
    map.invalidateSize();
    if (stopCoords.length) {
      map.fitBounds(stopCoords, { padding: [40, 40] });
    }
  }, 0);

  // plot other places without changing zoom
  places.forEach((p) => {
    const ll = [p.lat, p.lng];
    const color = getColorForRating(p.rating);
    L.circleMarker(ll, {
      radius: 6,
      fillColor: color,
      color: "#000",
      weight: 1,
      fillOpacity: 0.5,
    })
      .addTo(map)
      .bindPopup(
        `<strong>${p.name}</strong><br>` + `Rating: ${p.rating ?? "–"}/5`,
      );
  });
}

function renderList(stops, speed) {
  const listEl = document.getElementById("planning-list");
  listEl.innerHTML = "";
  listEl.classList.add("timeline");

  // current location
  const current = stops.find((s) => s.dueComplete);
  if (current) {
    const li = document.createElement("li");
    li.className = "stop-card current";
    li.innerHTML = `
      <h4>Current: ${current.name}</h4>
      <div class="links">
        ${
          current.navilyUrl
            ? `<a href="${current.navilyUrl}" target="_blank">Navily</a>`
            : ""
        }
        <a href="${current.trelloUrl}" target="_blank">Trello</a>
      </div>
    `;
    listEl.appendChild(li);
  }

  // 2) Group all future stops by calendar day and compute gaps
  const future = stops.filter(s => !s.dueComplete);
  future.forEach((s, idx) => {
    const next = future[idx + 1];
    if (next) {
      const diff = new Date(next.due) - new Date(s.due);
      s.hoursToNext = diff / 3600000;
      s.overnight   = next.due.slice(0,10) !== s.due.slice(0,10);
    } else {
      s.hoursToNext = null;
      s.overnight   = false;
    }
  });

  const byDay = future.reduce((acc, s) => {
    const day = s.due.slice(0, 10);
    (acc[day] ??= []).push(s);
    return acc;
  }, {});


  // 3) Iterate each day in order
  let prevStop = current;
  Object.keys(byDay).sort().forEach(dayKey => {
    // Day header
    const dateHeader = document.createElement('h3');
    dateHeader.textContent = new Date(dayKey).toLocaleDateString();
    listEl.appendChild(dateHeader);

    // Stops for that day
    byDay[dayKey].forEach((s) => {
      // A) compute distance & ETA from previous point
      const prev = prevStop;
      let infoHtml = '';
      if (prev) {
        const meters = haversine(prev.lat, prev.lng, s.lat, s.lng);
        const nm     = toNM(meters);
        const eta    = formatDurationRounded(nm / speed);
        infoHtml = `<em>${nm.toFixed(1)} NM, ETA: ${eta}</em>`;
      }

      // B) info about time until next stop
      let stayHtml = '';
      if (s.hoursToNext != null) {
        const hrs = Math.round(s.hoursToNext);
        const overnightText = s.overnight ? ' (overnight)' : '';
        stayHtml = `<div class="stay">${hrs}h until next stop${overnightText}</div>`;
      }

      // C) badges for labels (safe fallback)
      const labels = Array.isArray(s.labels) ? s.labels : [];
      const badges = labels
        .map(l => {
          const bg = l.color || '#888';
          const fg = badgeTextColor(bg);
          return `<span class="label" style="background:${bg};color:${fg}">${l.name}</span>`;
        })
        .join('');

      // D) star‑rating
      const stars = makeStars(s.rating);
      const ratingHtml = stars ? `<div class="rating">${stars}</div>` : '';

      // E) build the card
      const li = document.createElement('li');
      li.className = 'stop-card' + (s.overnight ? ' overnight' : '');
      li.onclick   = () => window.open(s.trelloUrl, '_blank');

      li.innerHTML = `
        <div class="header">${badges}</div>
        <h4>${s.name}</h4>
        <div class="subtitle">${s.listName}</div>
        ${ratingHtml}
        <div class="info">${infoHtml}</div>
        ${stayHtml}
        <div class="links">
          <a href="${s.trelloUrl}"  target="_blank">Trello</a>
          ${s.navilyUrl
            ? `<a href="${s.navilyUrl}" target="_blank">Navily</a>`
            : ''}
        </div>
      `;
      listEl.appendChild(li);
      prevStop = s;
    });
  });
}

function renderTable(stops, speed) {
  const tableEl = document.getElementById("planning-table");
  tableEl.innerHTML = `
    <thead>
      <tr>
        <th>Name</th>
        <th>Rating</th>
        <th>Distance (NM)</th>
        <th>ETA</th>
        <th>Links</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = tableEl.querySelector("tbody");

  // Helper to get decimal lat/lng from custom fields
  function getLatLng(stop) {
    // Use custom fields, fallback to stop.lat/lng if needed
    return (typeof stop.lat === "number" && typeof stop.lng === "number")
      ? [stop.lat, stop.lng]
      : [null, null];
  }

  // Find and render the current stop (dueComplete)
  const current = stops.find(s => s.dueComplete);
  if (current) {
    const stars = makeStars(current.rating);
    const links = `
      <a href="${current.trelloUrl}" target="_blank" title="Open in Trello">
        <i class="fab fa-trello"></i>
      </a>
      ${current.navilyUrl ? `
        <a href="${current.navilyUrl}" target="_blank" title="Open in Navily">
          <i class="fa-solid fa-anchor"></i>
        </a>
      ` : ""}
    `;
    const tr = document.createElement("tr");
    tr.className = "current-stop-row";
    tr.innerHTML = `
      <td>${current.name} <span class="current-badge-table">Current</span></td>
      <td>${stars}</td>
      <td></td>
      <td></td>
      <td>${links}</td>
    `;
    tbody.appendChild(tr);
  }

  // 1. Group by area (listName)
const byArea = {};
stops.filter(s => !s.dueComplete && s.due).forEach(s => {
  if (!byArea[s.listName]) byArea[s.listName] = [];
  byArea[s.listName].push(s);
});

// Use a single prevStop for the whole route, starting from current
let prevStop = current;

Object.entries(byArea).forEach(([area, areaStops]) => {
  // Area header row
  const areaRow = document.createElement("tr");
  areaRow.className = "area-header-row";
  areaRow.innerHTML = `<td colspan="5" class="area-header-table">${area}</td>`;
  tbody.appendChild(areaRow);
  

  // 2. Group area stops by day
  const byDay = {};
  areaStops.forEach(s => {
    const day = s.due ? s.due.slice(0, 10) : "No Date";
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(s);
  });

  Object.entries(byDay).sort().forEach(([day, dayStops]) => {
    // Day header row (calculate totals)
    let dayTotalNM = 0, dayTotalH = 0;
    let dayPrev = prevStop;
    dayStops.forEach((s) => {
      if (dayPrev) {
        const [lat1, lng1] = getLatLng(dayPrev);
        const [lat2, lng2] = getLatLng(s);
        if (
          typeof lat1 === "number" && typeof lng1 === "number" &&
          typeof lat2 === "number" && typeof lng2 === "number"
        ) {
          const meters = haversine(lat1, lng1, lat2, lng2);
          const nm = toNM(meters);
          dayTotalNM += nm;
          dayTotalH += nm / speed;
        }
      }
      dayPrev = s;
    });

    const dayRow = document.createElement("tr");
    dayRow.className = "day-header-row";
    dayRow.innerHTML = `<td colspan="5" class="day-header-table">
      ${formatDayLabel(day)}
      <span class="day-totals">
        ${dayTotalNM ? `&nbsp;•&nbsp;${dayTotalNM.toFixed(1)} NM` : ""}
        ${dayTotalH ? `&nbsp;•&nbsp;${formatDurationRounded(dayTotalH)}` : ""}
      </span>
    </td>`;
    tbody.appendChild(dayRow);

    // Sort stops by time
    dayStops.sort((a, b) => new Date(a.due) - new Date(b.due));

    // Insert current stop first if it belongs to this area/day
    if (current && current.listName === area && current.due && current.due.slice(0,10) === day) {
      const stars = makeStars(current.rating);
      const links = `
        <a href="${current.trelloUrl}" target="_blank" title="Open in Trello">
          <i class="fab fa-trello"></i>
        </a>
        ${current.navilyUrl ? `
          <a href="${current.navilyUrl}" target="_blank" title="Open in Navily">
            <i class="fa-solid fa-anchor"></i>
          </a>
        ` : ""}
      `;
      const tr = document.createElement("tr");
      tr.className = "current-stop-row";
      tr.innerHTML = `
        <td>${current.name} <span class="current-badge-table">Current</span></td>
        <td>${stars}</td>
        <td></td>
        <td></td>
        <td>${links}</td>
      `;
      tbody.appendChild(tr);
      // Set prevStop for next leg
      prevStop = current;
    }

    // Now render the rest of the stops for this day
    dayStops.forEach((s, idx) => {
      // Distance & ETA using custom field lat/lng
      let nm = "", eta = "";
      if (prevStop) {
        const [lat1, lng1] = getLatLng(prevStop);
        const [lat2, lng2] = getLatLng(s);
        if (
          typeof lat1 === "number" && typeof lng1 === "number" &&
          typeof lat2 === "number" && typeof lng2 === "number"
        ) {
          const meters = haversine(lat1, lng1, lat2, lng2);
          nm = toNM(meters).toFixed(1);
          eta = formatDurationRounded(nm / speed);
        }
      }
      const stars = makeStars(s.rating);
      const links = `
        <a href="${s.trelloUrl}" target="_blank" title="Open in Trello">
          <i class="fab fa-trello"></i>
        </a>
        ${s.navilyUrl ? `
          <a href="${s.navilyUrl}" target="_blank" title="Open in Navily">
            <i class="fa-solid fa-anchor"></i>
          </a>
        ` : ""}
      `;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${s.name}</td>
        <td>${stars}</td>
        <td>${nm}</td>
        <td>${eta}</td>
        <td>${links}</td>
      `;
      tbody.appendChild(tr);
      prevStop = s;
    });
  });
});

  // Helper for day label
  function formatDayLabel(dateStr) {
    if (!dateStr || dateStr === "No Date") return "No Date";
    const date = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    function ymd(d) { return d.toISOString().slice(0,10); }
    if (ymd(date) === ymd(today)) return "Today";
    if (ymd(date) === ymd(tomorrow)) return "Tomorrow";
    return date.toLocaleDateString(undefined, { weekday: "short" }); // e.g. "Mon"
  }
}

function renderCards(stops, speed) {
  const container = document.getElementById("planning-list");
  container.innerHTML = "";

  // Helper to get decimal lat/lng from custom fields
  function getLatLng(stop) {
    return (typeof stop.lat === "number" && typeof stop.lng === "number")
      ? [stop.lat, stop.lng]
      : [null, null];
  }

  const current = stops.find(s => s.dueComplete);

  // Group all other stops by area and day 
  const byArea = {};
  stops.filter(s => !s.dueComplete && s.due).forEach(s => {
    if (!byArea[s.listName]) byArea[s.listName] = [];
    byArea[s.listName].push(s);
  });

  // Use a single prevStop for the whole route, starting from current
  let prevStop = current;

  Object.entries(byArea).forEach(([area, areaStops]) => {
    // Area header
    const areaHeader = document.createElement("h2");
    areaHeader.textContent = area;
    areaHeader.className = "area-header";
    container.appendChild(areaHeader);

    // Group area stops by day
    const byDay = {};
    areaStops.forEach(s => {
      const day = s.due ? s.due.slice(0, 10) : "No Date";
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(s);
    });

    Object.entries(byDay).sort().forEach(([day, dayStops]) => {
      // Day totals
      let dayTotalNM = 0, dayTotalH = 0;
      let dayPrev = prevStop;
      dayStops.forEach((s) => {
        if (dayPrev) {
          const [lat1, lng1] = getLatLng(dayPrev);
          const [lat2, lng2] = getLatLng(s);
          if (
            typeof lat1 === "number" && typeof lng1 === "number" &&
            typeof lat2 === "number" && typeof lng2 === "number"
          ) {
            const meters = haversine(lat1, lng1, lat2, lng2);
            const nm = toNM(meters);
            dayTotalNM += nm;
            dayTotalH += nm / speed;
          }
        }
        dayPrev = s;
      });

      const dayHeader = document.createElement("h3");
      dayHeader.textContent = `${formatDayLabel(day)}${dayTotalNM ? ` • ${dayTotalNM.toFixed(1)} NM` : ""}${dayTotalH ? ` • ${formatDurationRounded(dayTotalH)}` : ""}`;
      dayHeader.className = "day-header";
      container.appendChild(dayHeader);

      // Insert current stop first if it belongs to this area/day
      if (current && current.listName === area && current.due && current.due.slice(0,10) === day) {
        const stars = makeStars(current.rating);
        const links = `
          <a href="${current.trelloUrl}" target="_blank" title="Open in Trello">
            <i class="fab fa-trello"></i>
          </a>
          ${current.navilyUrl ? `
            <a href="${current.navilyUrl}" target="_blank" title="Open in Navily">
              <i class="fa-solid fa-anchor"></i>
            </a>
          ` : ""}
        `;
        const card = document.createElement("div");
        card.className = "stop-card current-stop";
        card.innerHTML = `
          <div class="stop-header">
            <span class="current-badge">Current</span>
          </div>
          <div class="stop-name">${current.name}</div>
          <div class="stop-rating">${stars}</div>
          <div class="stop-links">${links}</div>
        `;
        container.appendChild(card);
        prevStop = current;
      }

      // Now render the rest of the stops for this day
      dayStops.forEach((s, idx) => {
        let nm = "", eta = "";
        if (prevStop) {
          const [lat1, lng1] = getLatLng(prevStop);
          const [lat2, lng2] = getLatLng(s);
          if (
            typeof lat1 === "number" && typeof lng1 === "number" &&
            typeof lat2 === "number" && typeof lng2 === "number"
          ) {
            const meters = haversine(lat1, lng1, lat2, lng2);
            nm = toNM(meters).toFixed(1);
            eta = formatDurationRounded(nm / speed);
          }
        }
        const stars = makeStars(s.rating);
        const links = `
          <a href="${s.trelloUrl}" target="_blank" title="Open in Trello">
            <i class="fab fa-trello"></i>
          </a>
          ${s.navilyUrl ? `
            <a href="${s.navilyUrl}" target="_blank" title="Open in Navily">
              <i class="fa-solid fa-anchor"></i>
            </a>
          ` : ""}
        `;
        const card = document.createElement("div");
        card.className = "stop-card";
        card.innerHTML = `
          <div class="stop-name">${s.name}</div>
          <div class="stop-rating">${stars}</div>
          <div class="stop-distance"><strong>Distance:</strong> ${nm} NM</div>
          <div class="stop-eta"><strong>ETA:</strong> ${eta}</div>
          <div class="stop-links">${links}</div>
        `;
        container.appendChild(card);
        prevStop = s;
      });
    });
  });

  // Helper for day label
  function formatDayLabel(dateStr) {
    if (!dateStr || dateStr === "No Date") return "No Date";
    const date = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    function ymd(d) { return d.toISOString().slice(0,10); }
    if (ymd(date) === ymd(today)) return "Today";
    if (ymd(date) === ymd(tomorrow)) return "Tomorrow";
    return date.toLocaleDateString(undefined, { weekday: "short" }); // e.g. "Mon"
  }
}

function initTabs() {
  document.querySelectorAll(".tab-nav button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".tab-nav button")
        .forEach((b) => b.classList.remove("active"));
      document
        .querySelectorAll(".tab-content")
        .forEach((s) => s.classList.add("hidden"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.remove("hidden");
    });
  });
}

async function init() {
  const { stops, places } = await fetchData();
  console.log("Planned stops:", stops);

  const speedInput = document.getElementById("speed-input");
  const plannedOnlyToggle = document.getElementById("planned-only-toggle");

  function renderMapWithToggle() {
    // Remove any existing map instance
    if (document.getElementById("map")._leaflet_id) {
      document.getElementById("map")._leaflet_id = null;
      document.getElementById("map").innerHTML = "";
    }
    if (plannedOnlyToggle.checked) {
      initMap(stops, []);
    } else {
      initMap(stops, places);
    }
  }

  renderMapWithToggle();
  renderTable(stops, parseFloat(speedInput.value));
  renderCards(stops, parseFloat(speedInput.value));

  // Update on speed change:
  speedInput.addEventListener("input", () => {
    const speed = parseFloat(speedInput.value) || 0;
    renderTable(stops, speed);
    renderCards(stops, speed);
  });

  plannedOnlyToggle.addEventListener("change", renderMapWithToggle);

  initTabs();
}

document.addEventListener("DOMContentLoaded", init);
