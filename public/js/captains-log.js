// public/js/captains-log.js

let leafletMap = null;

// Store the last loaded logs for filtering
let lastLoadedLogs = null;

let currentLogFilter = null; // {start, end} or null for most recent trip

let allLogsCache = null; // Store all logs here

let stops = [];
let places = [];
let plannedOnlyToggle = null;

let mostRecentTripRange = null;

let canPlan = false;

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

function updateSummary(stops, speed) {
  const summaryEl = document.getElementById('planning-summary');
  if (!summaryEl) return;

  const future = stops.filter(s => !s.dueComplete && s.due);
  const current = stops.find(s => s.dueComplete) || null;
  let prev = current;
  let totalNM = 0;

  future.forEach(s => {
    if (prev) {
      const meters = haversine(prev.lat, prev.lng, s.lat, s.lng);
      totalNM += toNM(meters);
    }
    prev = s;
  });

  const totalH = totalNM / speed;
  summaryEl.textContent = `Total: ${totalNM.toFixed(1)} NM • ${formatDurationRounded(totalH)}`;
}

async function fetchData() {
  const res = await fetch("/api/data");
  const data = await res.json();
  canPlan = data.canPlan;
  return data;
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

async function preloadAllLogs() {
  try {
    const res = await fetch("/api/logs?trip=all");
    if (!res.ok) throw new Error("Network response not ok");
    const json = await res.json();
    allLogsCache = json.logs || [];
    mostRecentTripRange = json.mostRecentTripRange || null;
    // If log tab is visible, render now
    if (isLogTabActive()) {
      // Use your default filter (most recent trip)
      currentLogFilter = null;
      // You need to pass stops to renderFilteredLogs; if not in scope, make sure it is
      if (typeof stops !== "undefined") {
        // Call the same render function as in setupLogTab
        const logBtn = document.querySelector('[data-tab="log"]');
        if (logBtn) logBtn.click();
      }
    }
  } catch (err) {
    console.error("Failed to preload logs:", err);
    allLogsCache = [];
  }
}

function isLogTabActive() {
  const logSection = document.getElementById('log');
  return logSection && !logSection.classList.contains('hidden');
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

    // ...inside stops.forEach in initMap...
    let popupHtml = `<strong>${s.dueComplete ? "Current:" : ""} ${s.name}</strong><br>`;
    if (!s.dueComplete) {
      popupHtml += `${new Date(s.due).toLocaleDateString()}<br>`;
      popupHtml += `Rating: ${s.rating ?? "–"}/5<br>`;
    }
    popupHtml += `<a href="${s.trelloUrl}" target="_blank">Trello</a>`;
    if (canPlan && s.due) {
      popupHtml += `<br><button class="plan-btn" data-card-id="${s.id}">Plan</button>`;
      popupHtml += `<button class="remove-btn" data-card-id="${s.id}">Remove</button>`;
    }

    L.circleMarker(ll, {
      radius: 14, // larger for easier tapping
      fillColor: color,
      color: "#222", // darker border for contrast
      weight: 3,     // thicker border
      fillOpacity: 0.88,
      opacity: 1,
      className: "map-stop-marker"
    })
      .addTo(map)
      .bindPopup(popupHtml)
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

    let popupHtml = `<strong>${p.name}</strong><br>`;
    popupHtml += `Rating: ${p.rating ?? "–"}/5<br>`;
    popupHtml += `<a href="${p.trelloUrl}" target="_blank">Trello</a>`;
    if (canPlan) {
      popupHtml += `<br><button class="plan-btn" data-card-id="${p.id}">Plan</button>`;
    }

    L.circleMarker(ll, {
      radius: 10,
      fillColor: color,
      color: "#000",
      weight: 1,
      fillOpacity: 0.5,
    })
      .addTo(map)
      .bindPopup(popupHtml)
      .bindTooltip(p.name, {
        permanent: false, // only show on hover/tap
        direction: "right",
        offset: [10, 0],
        className: "map-label"
      })
  });

  // Attach event listener for plan button when popup opens
  map.on('popupopen', function(e) {
    const btn = e.popup._contentNode.querySelector('.plan-btn');
    if (btn) {
      btn.addEventListener('click', async (ev) => {
        console.log('Plan button clicked for card ID:', btn.getAttribute('data-card-id'));
        ev.preventDefault();
        const cardId = btn.getAttribute('data-card-id');
        // Find the latest due date
      const lastDue = stops
        .filter(s => s.due)
        .map(s => new Date(s.due))
        .sort((a, b) => b - a)[0];
      const nextDue = new Date(lastDue);
      nextDue.setDate(nextDue.getDate() + 1);
      // Call backend to update the card's due date
      const res = await fetch(`/api/plan-stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, due: nextDue.toISOString() })
      });
      if (res.ok) {
        // Refresh planning data, table, and map
        const data = await fetchData();
        stops = data.stops;
        places = data.places;
        renderMapWithToggle();
        renderTable(stops, parseFloat(document.getElementById("speed-input").value));
        renderCards(stops, parseFloat(document.getElementById("speed-input").value));
      } else {
        alert('Failed to plan stop.');
      }
      });
    }
    const removeBtn = e.popup._contentNode.querySelector('.remove-btn');
    if (removeBtn) {
      removeBtn.addEventListener('click', async (ev) => {
        console.log('Remove button clicked for card ID:', removeBtn.getAttribute('data-card-id'));
        ev.preventDefault();
        ev.stopPropagation();
        const cardId = removeBtn.getAttribute('data-card-id');
        if (!confirm('Remove this planned stop?')) return;
        const res = await fetch(`/api/remove-stop`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId })
        });
        if (res.ok) {
          const data = await fetchData();
          stops = data.stops;
          places = data.places;
          renderMapWithToggle();
          renderTable(stops, parseFloat(document.getElementById("speed-input").value));
          renderCards(stops, parseFloat(document.getElementById("speed-input").value));
        } else {
          alert('Failed to remove stop.');
        }
      });
    }
  });
  
  return map;
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

function handlePlanButtonClicks() {
  document.querySelectorAll('.plan-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      console.log('Plan button clicked for card ID:', btn.getAttribute('data-card-id'));
      e.preventDefault();
      const cardId = btn.getAttribute('data-card-id');
      // Find the latest due date
      const lastDue = stops
        .filter(s => s.due)
        .map(s => new Date(s.due))
        .sort((a, b) => b - a)[0];
      const nextDue = new Date(lastDue);
      nextDue.setDate(nextDue.getDate() + 1);
      // Call backend to update the card's due date
      const res = await fetch(`/api/plan-stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, due: nextDue.toISOString() })
      });
      if (res.ok) {
        // Refresh planning data, table, and map
        const data = await fetchData();
        stops = data.stops;
        places = data.places;
        renderMapWithToggle();
        renderTable(stops, parseFloat(document.getElementById("speed-input").value));
        renderCards(stops, parseFloat(document.getElementById("speed-input").value));
      } else {
        alert('Failed to plan stop.');
      }
    });
  });
}

function handleRemoveButtonClicks() {
  document.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const cardId = btn.getAttribute('data-card-id');
      const res = await fetch(`/api/remove-stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId })
      });
      if (res.ok) {
        // Refresh planning data, table, and map
        const data = await fetchData();
        stops = data.stops;
        places = data.places;
        renderMapWithToggle();
        renderTable(stops, parseFloat(document.getElementById("speed-input").value));
        renderCards(stops, parseFloat(document.getElementById("speed-input").value));
      } else {
        alert('Failed to remove stop.');
      }
    });
  });
}

function renderTable(stops, speed) {
  updateSummary(stops, speed);
  const tableEl = document.getElementById("planning-table");
  tableEl.innerHTML = `
    <thead>
      <tr>
        <th>Name</th>
        <th>Labels</th>
        <th>Rating</th>
        <th>Distance (NM)</th>
        <th>ETA</th>
        <th>Links</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = tableEl.querySelector("tbody");
  tbody.classList.add("sortable-table-body");

  function getLatLng(stop) {
    return (typeof stop.lat === "number" && typeof stop.lng === "number")
      ? [stop.lat, stop.lng]
      : [null, null];
  }

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
    const labels = Array.isArray(current.labels) ? current.labels.map(l => {
      const bg = l.color || '#888';
      const fg = badgeTextColor(bg);
      return `<span class="label" style="background:${bg};color:${fg}">${l.name}</span>`;
    }).join('') : '';
    const tr = document.createElement("tr");
    tr.className = "current-stop-row";
    tr.innerHTML = `
      <td>${current.name} <span class="current-badge-table">Current</span></td>
      <td>${labels}</td>
      <td>${stars}</td>
      <td></td>
      <td></td>
      <td>${links}</td>
    `;
    tbody.appendChild(tr);
  }

  // Group all future stops by date only
  const future = stops.filter(s => !s.dueComplete && s.due);
  const byDay = future.reduce((acc, s) => {
    const day = s.due.slice(0, 10);
    (acc[day] ??= []).push(s);
    return acc;
  }, {});

  let prevStop = current;
  Object.keys(byDay).sort().forEach(dayKey => {
    // Day header row (calculate totals)
    let dayTotalNM = 0, dayTotalH = 0;
    let dayPrev = prevStop;
    byDay[dayKey].forEach((s) => {
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
    dayRow.setAttribute('data-day', dayKey);
    dayRow.innerHTML = `<td colspan="6" class="day-header-table">
      ${formatDayLabel(dayKey)}
      <span class="day-totals">
        ${dayTotalNM ? `&nbsp;•&nbsp;${dayTotalNM.toFixed(1)} NM` : ""}
        ${dayTotalH ? `&nbsp;•&nbsp;${formatDurationRounded(dayTotalH)}` : ""}
      </span>
    </td>`;
    tbody.appendChild(dayRow);
    // Sort stops by time
    byDay[dayKey].sort((a, b) => new Date(a.due) - new Date(b.due));

    // Insert current stop first if it belongs to this day
    if (current && current.due && current.due.slice(0,10) === dayKey) {
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
      const labels = Array.isArray(current.labels) ? current.labels.map(l => {
        const bg = l.color || '#888';
        const fg = badgeTextColor(bg);
        return `<span class="label" style="background:${bg};color:${fg}">${l.name}</span>`;
      }).join('') : '';
      const tr = document.createElement("tr");
      tr.className = "current-stop-row";
      tr.innerHTML = `
        <td>${current.name} <span class="current-badge-table">Current</span></td>
        <td>${labels}</td>
        <td>${stars}</td>
        <td></td>
        <td></td>
        <td>${links}</td>
      `;
      tbody.appendChild(tr);
      prevStop = current;
    }

    // Now render the rest of the stops for this day
    byDay[dayKey].forEach((s, idx) => {
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
      const removeBtn = canPlan && s.due
        ? `<button class="remove-btn" data-card-id="${s.id}" title="Remove planned stop" style="margin-left:0.5em;">Remove</button>`
        : "";
      const links = `
        <a href="${s.trelloUrl}" target="_blank" title="Open in Trello">
          <i class="fab fa-trello"></i>
        </a>
        ${s.navilyUrl ? `
          <a href="${s.navilyUrl}" target="_blank" title="Open in Navily">
            <i class="fa-solid fa-anchor"></i>
          </a>
        ` : ""}
        ${removeBtn}
      `;
      const labels = Array.isArray(s.labels) ? s.labels.map(l => {
        const bg = l.color || '#888';
        const fg = badgeTextColor(bg);
        return `<span class="label" style="background:${bg};color:${fg}">${l.name}</span>`;
      }).join('') : '';
      const tr = document.createElement("tr");
      tr.setAttribute("data-card-id", s.id); // <-- add this
      tr.className = "sortable-stop-row";
      tr.setAttribute("data-day", dayKey); // for drag-and-drop grouping
      tr.innerHTML = `
        <td>${s.name}</td>
        <td>${labels}</td>
        <td>${stars}</td>
        <td>${nm}</td>
        <td>${eta}</td>
        <td>${links}</td>
      `;
      tbody.appendChild(tr);
      prevStop = s;
    });
  });

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
  handleRemoveButtonClicks();
  initTableDragAndDrop();
}

function initTableDragAndDrop() {
  const tbody = document.querySelector('.sortable-table-body');
  if (!tbody) return;

  // Destroy previous Sortable if any
  if (tbody._sortable) {
    tbody._sortable.destroy();
    tbody._sortable = null;
  }

  tbody._sortable = Sortable.create(tbody, {
    handle: 'td',
    animation: 150,
    filter: '.day-header-row,.current-stop-row',
    draggable: '.sortable-stop-row',
    onEnd: async function (evt) {
      // Walk through all rows, updating data-day for each stop row to match the most recent day header above it
      const rows = Array.from(tbody.querySelectorAll('tr'));
      let currentDay = null;
      const updatesByDay = {};

      rows.forEach(row => {
        if (row.classList.contains('day-header-row')) {
          currentDay = row.getAttribute('data-day');
        } else if (row.classList.contains('sortable-stop-row')) {
          if (currentDay) {
            row.setAttribute('data-day', currentDay);
            if (!updatesByDay[currentDay]) updatesByDay[currentDay] = [];
            updatesByDay[currentDay].push(row);
          }
        }
      });

      // For each day, assign new due dates in order (e.g., 08:00, 09:00, ...)
      const updates = [];
      Object.entries(updatesByDay).forEach(([day, rows]) => {
        const baseDate = new Date(day + 'T08:00:00');
        rows.forEach((row, i) => {
          const cardId = row.getAttribute('data-card-id');
          const due = new Date(baseDate.getTime() + i * 60 * 60 * 1000).toISOString();
          updates.push({ cardId, due });
        });
      });

      // Send to backend
      if (updates.length) {
        await fetch('/api/reorder-stops', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates })
        });
        // Add a short delay to allow Trello to update
        setTimeout(async () => {
          const data = await fetchData();
          stops = data.stops;
          places = data.places;
          renderMapWithToggle();
          renderTable(stops, parseFloat(document.getElementById("speed-input").value));
          renderCards(stops, parseFloat(document.getElementById("speed-input").value));
        }, 1000);
      }
    }
  });
}

function initCardsDragAndDrop() {
  document.querySelectorAll('.sortable-day').forEach(dayDiv => {
    // Destroy previous Sortable if any
    if (dayDiv._sortable) {
      dayDiv._sortable.destroy();
      dayDiv._sortable = null;
    }

    dayDiv._sortable = Sortable.create(dayDiv, {
      group: 'stops', // allow cross-day dragging
      animation: 150,
      draggable: '.stop-card',
      onEnd: async function (evt) {
        // Collect updates for ALL days after any drag
        const allUpdates = [];
        document.querySelectorAll('.sortable-day').forEach(dayDiv2 => {
          const day = dayDiv2.getAttribute('data-day');
          const cards = Array.from(dayDiv2.querySelectorAll('.stop-card'));
          const baseDate = new Date(day + 'T08:00:00');
          cards.forEach((card, i) => {
            allUpdates.push({
              cardId: card.getAttribute('data-card-id'),
              due: new Date(baseDate.getTime() + i * 60 * 60 * 1000).toISOString()
            });
          });
        });

        if (allUpdates.length) {
          await fetch('/api/reorder-stops', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates: allUpdates })
          });
          setTimeout(async () => {
            const data = await fetchData();
            stops = data.stops;
            places = data.places;
            renderMapWithToggle();
            renderTable(stops, parseFloat(document.getElementById("speed-input").value));
            renderCards(stops, parseFloat(document.getElementById("speed-input").value));
          }, 1000);
        }
      }
    });
  });
}

function renderCards(stops, speed) {
  updateSummary(stops, speed);
  const container = document.getElementById("planning-list");
  container.innerHTML = "";

  function getLatLng(stop) {
    return (typeof stop.lat === "number" && typeof stop.lng === "number")
      ? [stop.lat, stop.lng]
      : [null, null];
  }

  const current = stops.find(s => s.dueComplete);

  // Group all future stops by date only
  const future = stops.filter(s => !s.dueComplete && s.due);
  const byDay = future.reduce((acc, s) => {
    const day = s.due.slice(0, 10);
    (acc[day] ??= []).push(s);
    return acc;
  }, {});

  let prevStop = current;
  Object.keys(byDay).sort().forEach(dayKey => {
    // Day totals
    let dayTotalNM = 0, dayTotalH = 0;
    let dayPrev = prevStop;
    byDay[dayKey].forEach((s) => {
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
    dayHeader.textContent = `${formatDayLabel(dayKey)}${dayTotalNM ? ` • ${dayTotalNM.toFixed(1)} NM` : ""}${dayTotalH ? ` • ${formatDurationRounded(dayTotalH)}` : ""}`;
    dayHeader.className = "day-header";
    container.appendChild(dayHeader);

    // Create a div for this day’s stops
    const dayDiv = document.createElement("div");
    dayDiv.className = "sortable-day";
    dayDiv.setAttribute("data-day", dayKey);

    // Sort stops by time
    byDay[dayKey].sort((a, b) => new Date(a.due) - new Date(b.due));

    // Insert current stop first if it belongs to this day
    if (current && current.due && current.due.slice(0,10) === dayKey) {
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
      const labels = Array.isArray(current.labels) ? current.labels.map(l => {
        const bg = l.color || '#888';
        const fg = badgeTextColor(bg);
        return `<span class="label" style="background:${bg};color:${fg}">${l.name}</span>`;
      }).join('') : '';
      const card = document.createElement("div");
      card.className = "stop-card current-stop";
      card.innerHTML = `
        <div class="stop-header">
          ${labels}<span class="current-badge">Current</span>
        </div>
        <div class="stop-name">${current.name}</div>
        <div class="stop-rating">${stars}</div>
        <div class="stop-links">${links}</div>
      `;
      container.appendChild(card);
      prevStop = current;
    }

    // Now render the rest of the stops for this day
    byDay[dayKey].forEach((s, idx) => {
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
      const removeBtn = canPlan && s.due
        ? `<button class="remove-btn" data-card-id="${s.id}" title="Remove planned stop" style="margin-left:0.5em;">Remove</button>`
        : "";
      const links = `
        <a href="${s.trelloUrl}" target="_blank" title="Open in Trello">
          <i class="fab fa-trello"></i>
        </a>
        ${s.navilyUrl ? `
          <a href="${s.navilyUrl}" target="_blank" title="Open in Navily">
            <i class="fa-solid fa-anchor"></i>
          </a>
        ` : ""}
        ${removeBtn}
      `;
      const labels = Array.isArray(s.labels) ? s.labels.map(l => {
        const bg = l.color || '#888';
        const fg = badgeTextColor(bg);
        return `<span class="label" style="background:${bg};color:${fg}">${l.name}</span>`;
      }).join('') : '';
      const card = document.createElement("div");
      card.className = "stop-card";
      card.setAttribute("data-card-id", s.id); // <-- add this
      card.innerHTML = `
        <div class="stop-header">${labels}</div>
        <div class="stop-name">${s.name}</div>
        <div class="stop-rating">${stars}</div>
        <div class="stop-distance"><strong>Distance:</strong> ${nm} NM</div>
        <div class="stop-eta"><strong>ETA:</strong> ${eta}</div>
        <div class="stop-links">${links}</div>
      `;
      dayDiv.appendChild(card);
      prevStop = s;
    });

    container.appendChild(dayDiv); // <-- append the day's div
  });

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
  handleRemoveButtonClicks();
  initCardsDragAndDrop();
}

function renderHistoricalLog(logs = [], stops = []) {
  const section = document.getElementById("log-list");
  if (!section) return;
  section.innerHTML = "";

  const arrived = logs
    .filter(l => l.type === "Arrived")
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // DESCENDING
  if (!arrived.length) {
    section.innerHTML = "<p>No visits found.</p>";
    return;
  }

  arrived.forEach(l => {
    const stop = stops.find(s => s.id === l.cardId) || stops.find(s => s.name === l.cardName);
    const stars = stop ? makeStars(stop.rating) : "";
    const navily = stop && stop.navilyUrl ? `<a href="${stop.navilyUrl}" target="_blank" title="Navily"><i class="fa-solid fa-anchor"></i></a>` : "";
    const trello = l.trelloUrl ? `<a href="${l.trelloUrl}" target="_blank" title="Trello"><i class="fab fa-trello"></i></a>` : "";

    const div = document.createElement("div");
    div.className = "historical-log-entry";
    div.innerHTML = `
      <div class="historical-log-place">${l.cardName}</div>
      <div class="historical-log-date">${new Date(l.timestamp).toLocaleDateString()} ${new Date(l.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div>
      <div class="historical-log-rating">${stars}</div>
      <div class="historical-log-links">${navily}${trello}</div>
    `;
    section.appendChild(div);
  });
}

// Render historical map (only arrived unique places). Uses window.histMap to cleanup.
function renderLogMap(logs = [], stops = []) {
  console.log("Rendering historical map with", logs.length, "logs and", stops.length, "stops");
  const mapDiv = document.getElementById("log-map");
  if (!mapDiv) return;

  // cleanup previous map instance for this div
  if (window.histMap) {
    try { window.histMap.remove(); } catch(e) { /* ignore */ }
    window.histMap = null;
  }
  mapDiv.innerHTML = "";

  const arrived = logs
    .filter(l => l.type === "Arrived")
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // unique by cardId
  const unique = [];
  const seen = new Set();
  arrived.forEach(l => {
    if (!seen.has(l.cardId)) { seen.add(l.cardId); unique.push(l); }
  });

  const markers = unique.map(l => ({
    lat: typeof l.lat === "number" ? l.lat : null,
    lng: typeof l.lng === "number" ? l.lng : null,
    name: l.cardName,
    rating: l.rating,
    navilyUrl: l.navilyUrl,
    trelloUrl: l.trelloUrl,
    date: l.timestamp
  })).filter(m => typeof m.lat === "number" && typeof m.lng === "number");

  // create map
  window.histMap = L.map(mapDiv).setView([0,0], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(window.histMap);

  const bounds = [];
  markers.forEach(m => {
    const color = getColorForRating(m.rating);
    L.circleMarker([m.lat, m.lng], {
      radius: 4,
      fillColor: color,
      color: "transparent",
      weight: 0,
      fillOpacity: 0.88,
      opacity: 1,
      className: "map-stop-marker"
    })
      .addTo(window.histMap)
      .bindPopup(`<strong>${m.name}</strong><br>${m.rating ? makeStars(m.rating) : ""}<br>${new Date(m.date).toLocaleDateString()}`)
      .bindTooltip(m.name, { permanent: false, direction: "right", offset: [10,0], className: "map-label" });
    bounds.push([m.lat, m.lng]);
  });

  if (bounds.length) {
    window.histMap.fitBounds(bounds, { padding: [40,40] });
  }

  // --- Always invalidate size after rendering ---
  setTimeout(() => {
    window.histMap.invalidateSize();
  }, 0);
}

function renderMapWithToggle() {
    // Properly remove any existing map instance
    if (leafletMap) {
      leafletMap.remove();
      leafletMap = null;
    }
    if (plannedOnlyToggle.checked) {
      leafletMap = initMap(stops, []);
    } else {
      leafletMap = initMap(stops, places);
    }
  }

function getMostRecentTripRangeFromTrips(trips) {
  // Flatten all trips into one array if grouped by year
  let allTrips = [];
  if (Array.isArray(trips)) {
    if (trips.length && Array.isArray(trips[0].trips)) {
      trips.forEach(group => allTrips.push(...group.trips));
    } else {
      allTrips = trips;
    }
  }
  // Sort by start date descending
  allTrips = allTrips
    .filter(t => t.start)
    .sort((a, b) => new Date(b.start) - new Date(a.start));
  if (!allTrips.length) return null;
  const mostRecent = allTrips[0];
  return { start: mostRecent.start, end: mostRecent.due || null };
}

function setupLogTab(stops = []) {
  const tabSelector = '[data-tab="log"]';
  const btn = document.querySelector(tabSelector);
  if (!btn) return;

  const showAllBtn = document.getElementById("show-all-logs-btn");
  const showLastTripBtn = document.getElementById("show-last-trip-btn");

  function renderFilteredLogs() {
    if (!allLogsCache) {
      const listDiv = document.getElementById("log-list");
      if (listDiv) listDiv.innerHTML = "<p>Loading logs…</p>";
      return;
    }
    let logsToShow = allLogsCache;
    if (currentLogFilter === 'all') {
      logsToShow = allLogsCache;
    } else if (currentLogFilter && currentLogFilter.start) {
      logsToShow = filterLogsByDate(allLogsCache, currentLogFilter.start, currentLogFilter.end);
    } else if (mostRecentTripRange && mostRecentTripRange.start) {
      logsToShow = filterLogsByDate(allLogsCache, mostRecentTripRange.start, mostRecentTripRange.end);
    }
    renderHistoricalLog(logsToShow, stops);
    window._lastLogMapData = logsToShow;

    // --- ADD THIS: update the map if the log tab is visible ---
    if (isLogTabActive()) {
      renderLogMap(logsToShow, stops);
    }
  }

  btn.addEventListener("click", () => {
    currentLogFilter = null; // reset to most recent trip
    renderFilteredLogs();
  });

  if (showAllBtn) {
    showAllBtn.addEventListener("click", () => {
      currentLogFilter = 'all';
      renderFilteredLogs();
    });
  }

  if (showLastTripBtn) {
    showLastTripBtn.addEventListener("click", () => {
      currentLogFilter = null; // null means "most recent trip"
      renderFilteredLogs();
    });
  }
}

// Utility to filter logs by date range
function filterLogsByDate(logs, start, end) {
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  return logs.filter(l => {
    const d = new Date(l.timestamp);
    return (!startDate || d >= startDate) && (!endDate || d <= endDate);
  });
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

      // Hide planned map when not on planning tab
      const mapDiv = document.getElementById("map");
      if (btn.dataset.tab !== "planning" && mapDiv) {
        mapDiv.style.display = "none";
        if (leafletMap) {
          leafletMap.remove();
          leafletMap = null;
        }
      } else if (btn.dataset.tab === "planning" && mapDiv) {
        mapDiv.style.display = "";
        // Re-initialize the map if needed
        if (!leafletMap) {
          // You must call the same function you use in init() to render the map
          // For example:
          const speed = parseFloat(document.getElementById("speed-input").value) || 0;
          const plannedOnlyToggle = document.getElementById("planned-only-toggle");
          // You need to have stops and places in scope; if not, store them globally in init()
          renderMapWithToggle();
        }
      }

      if (btn.dataset.tab === "log") {
        // Render the map now that the container is visible
        setTimeout(() => {
          // Use the logs that were last filtered
          if (window._lastLogMapData) {
            renderLogMap(window._lastLogMapData, stops);
          }
        }, 0);
      }
    });
  });
}

// Listen for clicks on historical trips
function setupHistoricalTripLinks(stops = []) {
  document.querySelectorAll('.historical-trip-link').forEach(li => {
    li.addEventListener('click', () => {
      // Switch to log tab
      document.querySelectorAll('.tab-nav button').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.tab === 'log') btn.classList.add('active');
      });
      document.querySelectorAll('.tab-content').forEach(sec => sec.classList.add('hidden'));
      document.getElementById('log').classList.remove('hidden');

      // Filter logs for this trip
      const start = li.getAttribute('data-trip-start');
      const end = li.getAttribute('data-trip-end');
      currentLogFilter = { start, end };
      renderHistoricalLog(filterLogsByDate(allLogsCache, start, end), stops);
      renderLogMap(filterLogsByDate(allLogsCache, start, end), stops);
    });
  });
}

async function init() {
  preloadAllLogs(); // Start loading logs in the background

  const data = await fetchData();
  stops = data.stops;
  places = data.places;

  const speedInput = document.getElementById("speed-input");
  plannedOnlyToggle = document.getElementById("planned-only-toggle");

  renderMapWithToggle();
  renderTable(stops, parseFloat(speedInput.value));
  renderCards(stops, parseFloat(speedInput.value));
  setupLogTab(stops);
  setupHistoricalTripLinks(stops);

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
