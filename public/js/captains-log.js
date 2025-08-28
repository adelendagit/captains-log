// public/js/captains-log.js

let leafletMap = null;

// Store the last loaded logs for filtering
let lastLoadedLogs = null;

let currentLogFilter = null; // {start, end} or null for most recent trip

let allLogsCache = null; // Store all logs here

let stops = [];
let places = [];
let plannedOnlyToggle = null;

let logLayerGroup = null;

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
  const totalMinutes = Math.round((h * 60) / 15) * 15;
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  if (hh && mm) return `${hh}h ${mm}m`;
  if (hh) return `${hh}h`;
  return `${mm}m`;
}

function getDateRange(startDate, endDate) {
  const dates = [];
  let current = new Date(startDate);
  const end = new Date(endDate);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function updateSummary(stops, speed) {
  const summaryEl = document.getElementById("planning-summary");
  if (!summaryEl) return;

  const future = stops.filter((s) => !s.dueComplete && s.due);
  const current = stops.find((s) => s.dueComplete) || null;
  let prev = current;
  let totalNM = 0;

  future.forEach((s) => {
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

// map rating/labels → color
function getMarkerColor(r, labels = []) {
  if (r != null) {
    const rating = Math.round(r);
    if (rating >= 5) return "#008000"; // 5 stars: green
    if (rating === 4) return "#90ee90"; // 4 stars: light green
    if (rating === 3) return "#ffffe0"; // 3 stars: light yellow
    if (rating === 2) return "#ffcccb"; // 2 stars: light red
    return "#ff0000"; // 1 star: red
  }
  const hasVisited = labels.some(
    (l) => l.name && l.name.toLowerCase() === "visited",
  );
  return hasVisited ? "#555555" : "#d3d3d3"; // dark grey if visited, else light grey
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

function makeEditableStars(r, cardId) {
  const current = r || 0;
  let html = `<span class="stars editable" data-card-id="${cardId}">`;
  for (let i = 1; i <= 5; i++) {
    const star = i <= current ? "★" : "☆";
    html += `<span class="star" data-value="${i}">${star}</span>`;
  }
  html += "</span>";
  return html;
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
      currentLogFilter = null;
      if (typeof stops !== "undefined") {
        const logBtn = document.querySelector('[data-tab="log"]');
        if (logBtn) logBtn.click();
      }
    }
    // --- Add this to update the planning map with logs ---
    renderMapWithToggle();
  } catch (err) {
    console.error("Failed to preload logs:", err);
    allLogsCache = [];
  }
}

function isLogTabActive() {
  const logSection = document.getElementById("log");
  return logSection && !logSection.classList.contains("hidden");
}

function initMap(stops, places, logs = null) {
  // Only create the map if it doesn't exist
  let map;
  if (leafletMap) {
    map = leafletMap;
  } else {
    map = L.map("map").setView([0, 0], 2);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(
      map,
    );
    leafletMap = map;
  }

  const stopCoords = [];

  // plot planned stops only
  stops.forEach((s) => {
    const ll = [s.lat, s.lng];
    stopCoords.push(ll);

    const color = getMarkerColor(s.rating, s.labels);

    let popupHtml = `<strong>${s.name}</strong><br>`;
    if (s.desc) {
      const escaped = s.desc
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
      popupHtml += `<div class="popup-desc collapsed">${escaped}</div>`;
      popupHtml += `<button class="desc-toggle">Show more</button><br>`;
    }
    if (s.due) {
      popupHtml += `${new Date(s.due).toLocaleDateString()}<br>`;
    }
    const starsHtml = canPlan
      ? makeEditableStars(s.rating, s.id)
      : makeStars(s.rating);
    popupHtml += `Rating: ${starsHtml}<br>`;
    const trelloLink = s.trelloUrl
      ? `<a href="${s.trelloUrl}" target="_blank" title="Open in Trello"><i class="fab fa-trello"></i></a>`
      : "";
    const navilyLink = s.navilyUrl
      ? `<a href="${s.navilyUrl}" target="_blank" title="Open in Navily"><i class="fa-solid fa-anchor"></i></a>`
      : "";
    popupHtml += `${trelloLink} ${navilyLink}`;
    if (canPlan && s.due) {
      popupHtml += `<br><button class="plan-btn" data-card-id="${s.id}">Plan</button>`;
      popupHtml += `<button class="remove-btn" data-card-id="${s.id}">Remove</button>`;
    }

    L.circleMarker(ll, {
      radius: 14,
      fillColor: color,
      color: "#cac8c8ff",
      weight: 3,
      fillOpacity: 0.88,
      opacity: 1,
      className: "map-stop-marker",
    })
      .addTo(map)
      .bindPopup(popupHtml)
      .bindTooltip(s.name, {
        permanent: true,
        direction: "right",
        offset: [10, 0],
        className: "map-label",
      });
  });

  if (stopCoords.length > 1) {
    const polyline = L.polyline(stopCoords, { color: "#555", weight: 2 }).addTo(
      map,
    );

    // Add direction arrows
    const arrowHeadFn =
      (L.Symbol && L.Symbol.arrowHead) || (L.Symbols && L.Symbols.arrowHead);

    if (arrowHeadFn) {
      L.polylineDecorator(polyline, {
        patterns: [
          {
            offset: "5%",
            repeat: "20%",
            symbol: arrowHeadFn({
              pixelSize: 12,
              polygon: false,
              pathOptions: { stroke: true, color: "#0077cc", weight: 2 },
            }),
          },
        ],
      }).addTo(map);
    } else {
      console.warn("Leaflet PolylineDecorator arrowHead not found.");
    }
  }

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
    const color = getMarkerColor(p.rating, p.labels);

    let popupHtml = `<strong>${p.name}</strong><br>`;
    if (p.desc) {
      const escaped = p.desc
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
      popupHtml += `<div class="popup-desc collapsed">${escaped}</div>`;
      popupHtml += `<button class="desc-toggle">Show more</button><br>`;
    }
    const starsHtml = canPlan
      ? makeEditableStars(p.rating, p.id)
      : makeStars(p.rating);
    popupHtml += `Rating: ${starsHtml}<br>`;
    const trelloLink = p.trelloUrl
      ? `<a href="${p.trelloUrl}" target="_blank" title="Open in Trello"><i class="fab fa-trello"></i></a>`
      : "";
    const navilyLink = p.navilyUrl
      ? `<a href="${p.navilyUrl}" target="_blank" title="Open in Navily"><i class="fa-solid fa-anchor"></i></a>`
      : "";
    popupHtml += `${trelloLink} ${navilyLink}`;
    if (canPlan) {
      popupHtml += `<br><button class="plan-btn" data-card-id="${p.id}">Plan</button>`;
    }

    L.circleMarker(ll, {
      radius: 10,
      fillColor: color,
      color: "#ffffffff",
      weight: 1,
      fillOpacity: 0.5,
    })
      .addTo(map)
      .bindPopup(popupHtml)
      .bindTooltip(p.name, {
        permanent: false,
        direction: "right",
        offset: [10, 0],
        className: "map-label",
      });
  });

  // --- Log data layer ---
  // Use a LayerGroup so we can update log data without recreating the map
  if (logLayerGroup) {
    logLayerGroup.clearLayers();
  } else {
    logLayerGroup = L.layerGroup().addTo(map);
  }

  if (logs && Array.isArray(logs)) {
    // Find all arrived logs, unique by cardId
    const arrived = logs
      .filter((l) => l.type === "Arrived")
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const unique = [];
    const seen = new Set();
    arrived.forEach((l) => {
      if (!seen.has(l.cardId)) {
        seen.add(l.cardId);
        unique.push(l);
      }
    });

    // Add the first departed log if it exists and has coordinates
    const firstDeparted = logs
      .filter((l) => l.type === "Departed")
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))[0];

    if (
      firstDeparted &&
      typeof firstDeparted.lat === "number" &&
      typeof firstDeparted.lng === "number" &&
      !seen.has(firstDeparted.cardId)
    ) {
      unique.unshift(firstDeparted);
    }

    // Plot markers and route
    const logMarkers = unique
      .map((l) => ({
        lat: typeof l.lat === "number" ? l.lat : null,
        lng: typeof l.lng === "number" ? l.lng : null,
        name: l.cardName,
        rating: l.rating,
        navilyUrl: l.navilyUrl,
        trelloUrl: l.trelloUrl,
        date: l.timestamp,
      }))
      .filter((m) => typeof m.lat === "number" && typeof m.lng === "number");

    const logCoords = logMarkers.map((m) => [m.lat, m.lng]);
    if (logCoords.length > 1) {
      L.polyline(logCoords, {
        color: "#888", // lighter gray
        weight: 2,
        opacity: 0.5, // more faint
        dashArray: "4 6", // dashed line
      }).addTo(logLayerGroup);
    }
    logMarkers.forEach((m) => {
      const color = getMarkerColor(m.rating);
      L.circleMarker([m.lat, m.lng], {
        radius: 4,
        fillColor: color,
        color: "transparent",
        weight: 0,
        fillOpacity: 0.88,
        opacity: 1,
        className: "map-log-marker",
      })
        .addTo(logLayerGroup)
        // .bindPopup(
        //   `<strong>${m.name}</strong><br>${m.rating ? makeStars(m.rating) : ""}<br>${new Date(m.date).toLocaleDateString()}`,
        // )
        .bindTooltip(m.name, {
          permanent: false,
          direction: "right",
          offset: [10, 0],
          className: "map-label",
        });
    });
  }

  // Attach event listener for plan/remove button when popup opens
  map.on("popupopen", function (e) {
    const btn = e.popup._contentNode.querySelector(".plan-btn");
    if (btn) {
      btn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = "Planning...";
        const cardId = btn.getAttribute("data-card-id");
        // Find the latest due date
        const lastDue = stops
          .filter((s) => s.due)
          .map((s) => new Date(s.due))
          .sort((a, b) => b - a)[0];
        const nextDue = new Date(lastDue);
        nextDue.setDate(nextDue.getDate() + 1);
        // Call backend to update the card's due date
        const res = await fetch(`/api/plan-stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId, due: nextDue.toISOString() }),
        });
        if (res.ok) {
          btn.textContent = "Planned!";
          setTimeout(async () => {
            const data = await fetchData();
            stops = data.stops;
            places = data.places;
            renderMapWithToggle();
            renderTable(
              stops,
              parseFloat(document.getElementById("speed-input").value),
            );
          }, 500);
        } else {
          btn.disabled = false;
          btn.textContent = originalText;
          alert("Failed to plan stop.");
        }
      });
    }
    const toggle = e.popup._contentNode.querySelector(".desc-toggle");
    if (toggle) {
      const descEl = e.popup._contentNode.querySelector(".popup-desc");
      toggle.addEventListener("click", () => {
        const collapsed = descEl.classList.toggle("collapsed");
        toggle.textContent = collapsed ? "Show more" : "Show less";
      });
      if (descEl) {
        const fullHeight = descEl.scrollHeight;
        if (fullHeight <= descEl.clientHeight + 1) {
          toggle.style.display = "none";
        }
      }
    }
    const removeBtn = e.popup._contentNode.querySelector(".remove-btn");
    if (removeBtn) {
      removeBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const cardId = removeBtn.getAttribute("data-card-id");
        if (!confirm("Remove this planned stop?")) return;
        const res = await fetch(`/api/remove-stop`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId }),
        });
        if (res.ok) {
          const data = await fetchData();
          stops = data.stops;
          places = data.places;
          renderMapWithToggle();
          renderTable(
            stops,
            parseFloat(document.getElementById("speed-input").value),
          );
        } else {
          alert("Failed to remove stop.");
        }
      });
    }
    // Enable editable stars in popup
    if (canPlan) {
      const container = e.popup._contentNode.querySelector(".stars.editable");
      if (container) {
        container.querySelectorAll(".star").forEach(star => {
          star.addEventListener("click", async (ev) => {
            ev.stopPropagation();
            const rating = parseInt(star.getAttribute("data-value"), 10);
            const cardId = container.getAttribute("data-card-id");
            const res = await fetch("/api/rate-place", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cardId, rating }),
            });
            if (res.ok) {
              container.querySelectorAll(".star").forEach(s => {
                const val = parseInt(s.getAttribute("data-value"), 10);
                s.textContent = val <= rating ? "★" : "☆";
              });
            } else {
              alert("Failed to save rating");
            }
          });
        });
      }
    }
  });

  return map;
}

function handlePlanButtonClicks() {
  document.querySelectorAll(".plan-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      console.log(
        "Plan button clicked for card ID:",
        btn.getAttribute("data-card-id"),
      );
      e.preventDefault();
      const cardId = btn.getAttribute("data-card-id");
      // Find the latest due date
      const lastDue = stops
        .filter((s) => s.due)
        .map((s) => new Date(s.due))
        .sort((a, b) => b - a)[0];
      const nextDue = new Date(lastDue);
      nextDue.setDate(nextDue.getDate() + 1);
      // Call backend to update the card's due date
      const res = await fetch(`/api/plan-stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId, due: nextDue.toISOString() }),
      });
      if (res.ok) {
        // Refresh planning data, table, and map
        const data = await fetchData();
        stops = data.stops;
        places = data.places;
        renderMapWithToggle();
        renderTable(
          stops,
          parseFloat(document.getElementById("speed-input").value),
        );
      } else {
        alert("Failed to plan stop.");
      }
    });
  });
}

function handleRemoveButtonClicks() {
  document.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const cardId = btn.getAttribute("data-card-id");
      const res = await fetch(`/api/remove-stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId }),
      });
      if (res.ok) {
        // Refresh planning data, table, and map
        const data = await fetchData();
        stops = data.stops;
        places = data.places;
        renderMapWithToggle();
        renderTable(
          stops,
          parseFloat(document.getElementById("speed-input").value),
        );
      } else {
        alert("Failed to remove stop.");
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
    return typeof stop.lat === "number" && typeof stop.lng === "number"
      ? [stop.lat, stop.lng]
      : [null, null];
  }

  const current = stops.find((s) => s.dueComplete);
  if (current) {
    const stars = canPlan
      ? makeEditableStars(current.rating, current.id)
      : makeStars(current.rating);
    const links = `
      <a href="${current.trelloUrl}" target="_blank" title="Open in Trello">
        <i class="fab fa-trello"></i>
      </a>
      ${
        current.navilyUrl
          ? `
        <a href="${current.navilyUrl}" target="_blank" title="Open in Navily">
          <i class="fa-solid fa-anchor"></i>
        </a>
      `
          : ""
      }
    `;
    const labels = Array.isArray(current.labels)
      ? current.labels
          .map((l) => {
            const bg = l.color || "#888";
            const fg = badgeTextColor(bg);
            return `<span class="label" style="background:${bg};color:${fg}">${l.name}</span>`;
          })
          .join("")
      : "";
    const tr = document.createElement("tr");
    tr.className = "current-stop-row";
    tr.innerHTML = `
      <td>${current.name} <span class="current-badge-table">Current</span></td>
      <td>${labels}</td>
      <td>${stars}</td>
      <td data-label="Distance (NM)"></td>
      <td data-label="ETA"></td>
      <td>${links}</td>
    `;
    tbody.appendChild(tr);
  }

  // Group all future stops by date only
  const future = stops.filter((s) => !s.dueComplete && s.due);
  const byDay = future.reduce((acc, s) => {
    const day = s.due.slice(0, 10);
    (acc[day] ??= []).push(s);
    return acc;
  }, {});

  // --- Compute full date range ---
  const todayStr = new Date().toISOString().slice(0, 10);
  const allDueDates = future.map((s) => s.due.slice(0, 10)).sort();
  const firstDate = allDueDates.length
    ? todayStr < allDueDates[0]
      ? todayStr
      : allDueDates[0]
    : todayStr;
  const lastDate = allDueDates.length
    ? allDueDates[allDueDates.length - 1]
    : todayStr;
  const dateRange = getDateRange(firstDate, lastDate);

  let prevStop = current;
  dateRange.forEach((dayKey) => {
    const stopsForDay = byDay[dayKey] || [];

    // Only render the day if:
    // - there are stops for this day, or
    // - the user can plan (logged in)
    if (stopsForDay.length > 0 || canPlan) {
      // Day header row (calculate totals)
      let dayTotalNM = 0,
        dayTotalH = 0;
      let dayPrev = prevStop;
      stopsForDay.forEach((s) => {
        if (dayPrev) {
          const [lat1, lng1] = getLatLng(dayPrev);
          const [lat2, lng2] = getLatLng(s);
          if (
            typeof lat1 === "number" &&
            typeof lng1 === "number" &&
            typeof lat2 === "number" &&
            typeof lng2 === "number"
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
      dayRow.setAttribute("data-day", dayKey);
      dayRow.innerHTML = `<td colspan="6" class="day-header-table">
        ${formatDayLabel(dayKey)}
        <span class="day-totals">
          ${dayTotalNM ? `&nbsp;•&nbsp;${dayTotalNM.toFixed(1)} NM` : ""}
          ${dayTotalH ? `&nbsp;•&nbsp;${formatDurationRounded(dayTotalH)}` : ""}
        </span>
      </td>`;
      tbody.appendChild(dayRow);

      // Sort stops by time
      stopsForDay.sort((a, b) => new Date(a.due) - new Date(b.due));

      // Now render the rest of the stops for this day
      stopsForDay.forEach((s, idx) => {
        let nm = "",
          eta = "";
        if (prevStop) {
          const [lat1, lng1] = getLatLng(prevStop);
          const [lat2, lng2] = getLatLng(s);
          if (
            typeof lat1 === "number" &&
            typeof lng1 === "number" &&
            typeof lat2 === "number" &&
            typeof lng2 === "number"
          ) {
            const meters = haversine(lat1, lng1, lat2, lng2);
            nm = toNM(meters).toFixed(1);
            eta = formatDurationRounded(nm / speed);
          }
        }
        const stars = canPlan
          ? makeEditableStars(s.rating, s.id)
          : makeStars(s.rating);
        const removeBtn =
          canPlan && s.due
            ? `<button class="remove-btn" data-card-id="${s.id}" title="Remove planned stop" style="margin-left:0.5em;">Remove</button>`
            : "";
        const links = `
          <a href="${s.trelloUrl}" target="_blank" title="Open in Trello">
            <i class="fab fa-trello"></i>
          </a>
          ${
            s.navilyUrl
              ? `
            <a href="${s.navilyUrl}" target="_blank" title="Open in Navily">
              <i class="fa-solid fa-anchor"></i>
            </a>
          `
              : ""
          }
          ${removeBtn}
        `;
        const labels = Array.isArray(s.labels)
          ? `<div class="labels-wrap">` +
            s.labels
              .map((l) => {
                const bg = l.color || "#888";
                const fg = badgeTextColor(bg);
                return `<span class="label" style="background:${bg};color:${fg}">${l.name}</span>`;
              })
              .join("") +
            `</div>`
          : "";
        const markerColor = getMarkerColor(s.rating, s.labels);
        const tr = document.createElement("tr");
        tr.setAttribute("data-card-id", s.id);
        tr.className = "sortable-stop-row";
        tr.setAttribute("data-day", dayKey);
        tr.style.borderLeft = `4px solid ${markerColor}`;
        tr.innerHTML = `
          <td>${s.name}</td>
          <td>${labels}</td>
          <td>${stars}</td>
          <td data-label="Distance (NM)">${nm}</td>
          <td data-label="ETA">${eta}</td>
          <td>${links}</td>
        `;
        tbody.appendChild(tr);
        prevStop = s;
      });

      // If no stops for this day, add an empty row for drag-and-drop (only for logged-in users)
      if (stopsForDay.length === 0 && canPlan) {
        const tr = document.createElement("tr");
        tr.className = "sortable-stop-row empty-drop-row";
        tr.setAttribute("data-day", dayKey);
        tr.innerHTML = `<td colspan="6" style="text-align:center; color:#bbb; font-style:italic;">No plans...</td>`;
        tbody.appendChild(tr);
      }
    }
    if (canPlan) {
      document.querySelectorAll(".stars.editable").forEach(container => {
        container.querySelectorAll(".star").forEach(star => {
          star.addEventListener("click", async (e) => {
            e.stopPropagation();
            const rating = parseInt(star.getAttribute("data-value"), 10);
            const cardId = container.getAttribute("data-card-id");
            const res = await fetch("/api/rate-place", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cardId, rating }),
            });
            if (res.ok) {
              container.querySelectorAll(".star").forEach(s => {
                const val = parseInt(s.getAttribute("data-value"), 10);
                s.textContent = val <= rating ? "★" : "☆";
              });
            } else {
              alert("Failed to save rating");
            }
          });
        });
      });
    }
  });

  function formatDayLabel(dateStr) {
    if (!dateStr || dateStr === "No Date") return "No Date";
    const date = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    function ymd(d) {
      return d.toISOString().slice(0, 10);
    }
    if (ymd(date) === ymd(today)) return "Today";
    if (ymd(date) === ymd(tomorrow)) return "Tomorrow";
    return date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }
  handleRemoveButtonClicks();
  initTableDragAndDrop();
}

function initTableDragAndDrop() {
  const tbody = document.querySelector(".sortable-table-body");
  if (!tbody) return;

  // Destroy previous Sortable if any
  if (tbody._sortable) {
    tbody._sortable.destroy();
    tbody._sortable = null;
  }

  if (!canPlan) return;

  tbody._sortable = Sortable.create(tbody, {
    handle: "td",
    animation: 150,
    filter: ".day-header-row,.current-stop-row",
    draggable: ".sortable-stop-row",
    // Delay drag start on touch devices so the page can scroll normally
    delay: 200,
    delayOnTouchOnly: true,
    touchStartThreshold: 10,
    onEnd: async function (evt) {
      // Walk through all rows, updating data-day for each stop row to match the most recent day header above it
      const rows = Array.from(tbody.querySelectorAll("tr"));
      let currentDay = null;
      const updatesByDay = {};

      rows.forEach((row) => {
        if (row.classList.contains("day-header-row")) {
          currentDay = row.getAttribute("data-day");
        } else if (row.classList.contains("sortable-stop-row")) {
          if (currentDay) {
            row.setAttribute("data-day", currentDay);
            if (!updatesByDay[currentDay]) updatesByDay[currentDay] = [];
            updatesByDay[currentDay].push(row);
          }
        }
      });

      // For each day, assign new due dates in order (e.g., 08:00, 09:00, ...)
      const updates = [];
      Object.entries(updatesByDay).forEach(([day, rows]) => {
        const baseDate = new Date(day + "T08:00:00");
        rows.forEach((row, i) => {
          const cardId = row.getAttribute("data-card-id");
          if (!cardId) return; // <-- skip empty placeholder rows
          const due = new Date(
            baseDate.getTime() + i * 60 * 60 * 1000,
          ).toISOString();
          updates.push({ cardId, due });
        });
      });

      // Send to backend
      if (updates.length) {
        await fetch("/api/reorder-stops", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates }),
        });
        // Add a short delay to allow Trello to update
        setTimeout(async () => {
          const data = await fetchData();
          stops = data.stops;
          places = data.places;
          renderMapWithToggle();
          renderTable(
            stops,
            parseFloat(document.getElementById("speed-input").value),
          );
        }, 1000);
      }
    },
  });
}

function renderHistoricalLog(logs = [], stops = []) {
  const section = document.getElementById("log-list");
  if (!section) return;
  section.innerHTML = "";

  // Find all arrived logs
  const arrived = logs
    .filter((l) => l.type === "Arrived")
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // DESCENDING

  // Find the first departed log (earliest by timestamp)
  const firstDeparted = logs
    .filter((l) => l.type === "Departed")
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))[0];

  // Insert the first departed at the start, if it exists
  if (firstDeparted) {
    arrived.push(firstDeparted);
    console.log("Added first departed log:", firstDeparted);
  }

  if (!arrived.length) {
    section.innerHTML = "<p>No visits found.</p>";
    return;
  }

  arrived.forEach((l) => {
    const stop =
      stops.find((s) => s.id === l.cardId) ||
      stops.find((s) => s.name === l.cardName);
    const currentRating = stop ? stop.rating : l.rating;
    const ratingHtml = canPlan
      ? makeEditableStars(currentRating, l.cardId)
      : currentRating != null
        ? makeStars(currentRating)
        : "";
    const navily =
      stop && stop.navilyUrl
        ? `<a href="${stop.navilyUrl}" target="_blank" title="Navily"><i class="fa-solid fa-anchor"></i></a>`
        : l.navilyUrl
          ? `<a href="${l.navilyUrl}" target="_blank" title="Navily"><i class="fa-solid fa-anchor"></i></a>`
          : "";
    const trello = l.trelloUrl
      ? `<a href="${l.trelloUrl}" target="_blank" title="Trello"><i class="fab fa-trello"></i></a>`
      : "";

    const div = document.createElement("div");
    div.className = "historical-log-entry";
    div.innerHTML = `
      <div class="historical-log-place">${l.cardName}</div>
      <div class="historical-log-date">${new Date(l.timestamp).toLocaleDateString()} ${new Date(l.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
      <div class="historical-log-rating">${ratingHtml}</div>
      <div class="historical-log-links">${navily}${trello}</div>
      <div class="historical-log-type">${l.type}</div>
    `;
    section.appendChild(div);

    if (canPlan) {
      const container = div.querySelector(".stars.editable");
      if (container) {
        container.querySelectorAll(".star").forEach((star) => {
          star.addEventListener("click", async (e) => {
            e.stopPropagation();
            const rating = parseInt(star.getAttribute("data-value"), 10);
            const cardId = container.getAttribute("data-card-id");
            const res = await fetch("/api/rate-place", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cardId, rating }),
            });
            if (res.ok) {
              container.querySelectorAll(".star").forEach((s) => {
                const val = parseInt(s.getAttribute("data-value"), 10);
                s.textContent = val <= rating ? "★" : "☆";
              });
              const stop = stops.find((s) => s.id === cardId);
              if (stop) stop.rating = rating;
              if (lastLoadedLogs) {
                lastLoadedLogs.forEach((log) => {
                  if (log.cardId === cardId) log.rating = rating;
                });
              }
            } else {
              alert("Failed to save rating");
            }
          });
        });
      }
    }

    console.log("Rendered log entry:", l);
  });
}

// Render a summary of key log events
function renderLogSummary(logs = []) {
  const div = document.getElementById("log-summary");
  if (!div) return;

  // --- Totals across the selected logs ---
  let totalNM = 0;
  let totalHrs = 0;
  let totalDiesel = 0;
  let lastDepart = null;

  const chron = [...logs].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
  );
  chron.forEach((l) => {
    if (l.type === "Departed" && l.lat != null && l.lng != null) {
      lastDepart = l;
    } else if (
      l.type === "Arrived" &&
      lastDepart &&
      l.lat != null &&
      l.lng != null
    ) {
      const meters = haversine(lastDepart.lat, lastDepart.lng, l.lat, l.lng);
      totalNM += toNM(meters);
      const hrs =
        (new Date(l.timestamp) - new Date(lastDepart.timestamp)) / 3600000;
      if (isFinite(hrs)) totalHrs += hrs;
      lastDepart = null;
    }

    if (l.type === "Diesel" && typeof l.dieselLitres === "number") {
      totalDiesel += l.dieselLitres;
    }
  });

  const efficiency = totalDiesel > 0 ? totalNM / totalDiesel : null;
  const latestDiesel = chron
    .filter((l) => l.type === "Diesel" && typeof l.dieselLitres === "number")
    .slice(-1)[0];
  const remainingRange =
    efficiency && latestDiesel ? latestDiesel.dieselLitres * efficiency : null;

  const latest = (type) =>
    logs
      .filter((l) => l.type === type)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

  const water = latest("Water");
  const diesel = latest("Diesel");
  const seaTemp = latest("Sea Temperature");
  const gasChange = latest("Gas tank change");
  const gasRefill = latest("Gas tank refill");
  const bbqGas = latest("BBQ gas change");
  const broken = latest("Broken");
  const fixed = latest("Fixed");

  const items = [];
  if (water)
    items.push(
      `<li>Water: ${new Date(water.timestamp).toLocaleDateString()}</li>`,
    );
  if (diesel) {
    items.push(
      `<li>Diesel: ${new Date(diesel.timestamp).toLocaleDateString()}${
        diesel.dieselLitres != null ? ` (${diesel.dieselLitres} litres)` : ""
      }</li>`,
    );
  }
  if (seaTemp)
    items.push(
      `<li>Sea Temperature: ${seaTemp.seaTemp}&deg; on ${new Date(seaTemp.timestamp).toLocaleDateString()}</li>`,
    );
  if (gasChange)
    items.push(
      `<li>Gas tank change: ${new Date(gasChange.timestamp).toLocaleDateString()}</li>`,
    );
  if (gasRefill)
    items.push(
      `<li>Gas tank refill: ${new Date(gasRefill.timestamp).toLocaleDateString()}</li>`,
    );
  if (bbqGas)
    items.push(
      `<li>BBQ gas change: ${new Date(bbqGas.timestamp).toLocaleDateString()}</li>`,
    );
  if (broken)
    items.push(
      `<li>Broken: ${broken.item || ""} on ${new Date(broken.timestamp).toLocaleDateString()}</li>`,
    );
  if (fixed)
    items.push(
      `<li>Fixed: ${fixed.item || ""} on ${new Date(fixed.timestamp).toLocaleDateString()}</li>`,
    );

  const totalsHtml = `
    <h4>Totals</h4>
    <ul>
      <li>Total miles travelled: ${totalNM.toFixed(1)} NM</li>
      <li>Total hours travelled: ${formatDurationRounded(totalHrs)}</li>
      <li>Total diesel used: ${totalDiesel.toFixed(1)} litres</li>
      <li>Estimated diesel fuel efficiency: ${efficiency ? efficiency.toFixed(2) + " NM/litre" : "N/A"}</li>
      <li>Estimated remaining diesel range: ${remainingRange ? remainingRange.toFixed(1) + " NM" : "N/A"}</li>
    </ul>
  `;

  const latestHtml = items.length
    ? `<h4>Latest</h4><ul>${items.join("")}</ul>`
    : "";

  div.innerHTML = totalsHtml + latestHtml;
}

function renderBrokenItems(logs = []) {
  const div = document.getElementById("broken-items");
  if (!div) return;

  const itemsByName = {};
  logs
    .filter((l) => (l.type === "Broken" || l.type === "Fixed") && l.item)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    .forEach((l) => {
      const cleanItem = l.item
        .replace(/timestamp:\s*([0-9T:\- ]+)/i, "")
        .trim();
      itemsByName[cleanItem] = { item: cleanItem, fixed: l.type === "Fixed" };
    });

  const entries = Object.values(itemsByName);
  if (!entries.length) {
    div.innerHTML = "";
    return;
  }

  const list = entries
    .map((e) => `<li>${e.item}: ${e.fixed ? "Fixed" : "Broken"}</li>`)
    .join("");
  div.innerHTML = `<h4>Broken Items</h4><ul>${list}</ul>`;
}

// Render historical map (only arrived unique places). Uses window.histMap to cleanup.
function renderLogMap(logs = [], stops = []) {
  console.log(
    "Rendering historical map with",
    logs.length,
    "logs and",
    stops.length,
    "stops",
  );
  const mapDiv = document.getElementById("log-map");
  if (!mapDiv) return;

  // cleanup previous map instance for this div
  if (window.histMap) {
    try {
      window.histMap.remove();
    } catch (e) {
      /* ignore */
    }
    window.histMap = null;
  }
  mapDiv.innerHTML = "";

  const arrived = logs
    .filter((l) => l.type === "Arrived")
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // unique by cardId
  const unique = [];
  const seen = new Set();
  arrived.forEach((l) => {
    if (!seen.has(l.cardId)) {
      seen.add(l.cardId);
      unique.push(l);
    }
  });

  // Add the first departed log if it exists and has coordinates
  const firstDeparted = logs
    .filter((l) => l.type === "Departed")
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))[0];

  if (
    firstDeparted &&
    typeof firstDeparted.lat === "number" &&
    typeof firstDeparted.lng === "number" &&
    !seen.has(firstDeparted.cardId)
  ) {
    unique.unshift(firstDeparted); // Add at the start
  }

  const markers = unique
    .map((l) => ({
      lat: typeof l.lat === "number" ? l.lat : null,
      lng: typeof l.lng === "number" ? l.lng : null,
      name: l.cardName,
      rating: l.rating,
      navilyUrl: l.navilyUrl,
      trelloUrl: l.trelloUrl,
      date: l.timestamp,
    }))
    .filter((m) => typeof m.lat === "number" && typeof m.lng === "number");

  const plannedCoords = stops
    .filter((s) => typeof s.lat === "number" && typeof s.lng === "number")
    .map((s) => [s.lat, s.lng]);

  // create map
  window.histMap = L.map(mapDiv).setView([0, 0], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(
    window.histMap,
  );

  const bounds = [];
  markers.forEach((m) => {
    const color = getMarkerColor(m.rating);
    L.circleMarker([m.lat, m.lng], {
      radius: 4,
      fillColor: color,
      color: "transparent",
      weight: 0,
      fillOpacity: 0.88,
      opacity: 1,
      className: "map-stop-marker",
    })
      .addTo(window.histMap)
      .bindPopup(
        `<strong>${m.name}</strong><br>${m.rating ? makeStars(m.rating) : ""}<br>${new Date(m.date).toLocaleDateString()}`,
      )
      .bindTooltip(m.name, {
        permanent: false,
        direction: "right",
        offset: [10, 0],
        className: "map-label",
      });
    bounds.push([m.lat, m.lng]);
  });

  const logCoords = markers.map((m) => [m.lat, m.lng]);
  if (logCoords.length > 1) {
    L.polyline(logCoords, { color: "#555", weight: 2 }).addTo(window.histMap);
  }

  // if (plannedCoords.length > 1) {
  //   L.polyline(plannedCoords, { color: "#999", weight: 1, dashArray: "4 4" }).addTo(window.histMap);
  //   plannedCoords.forEach(ll => bounds.push(ll));
  // }
  if (plannedCoords.length > 1) {
    L.polyline(plannedCoords, {
      color: "#0077cc", // Brighter blue
      weight: 4, // Thicker line
      dashArray: "6 6", // More visible dashes
      opacity: 0.85,
    }).addTo(window.histMap);
    plannedCoords.forEach((ll) => bounds.push(ll));
  }
  plannedCoords.forEach((ll) => {
    L.circleMarker(ll, {
      radius: 8,
      fillColor: "#0077cc",
      color: "#fff",
      weight: 2,
      fillOpacity: 1,
      opacity: 1,
      className: "map-planned-marker",
    }).addTo(window.histMap);
  });

  if (bounds.length) {
    window.histMap.fitBounds(bounds, { padding: [40, 40] });
  }

  // --- Always invalidate size after rendering ---
  setTimeout(() => {
    window.histMap.invalidateSize();
  }, 0);
}

function renderMapWithToggle() {
  // Only pass logs if they are loaded
  let logs = null;
  if (
    allLogsCache &&
    Array.isArray(allLogsCache) &&
    mostRecentTripRange &&
    mostRecentTripRange.start
  ) {
    logs = filterLogsByDate(
      allLogsCache,
      mostRecentTripRange.start,
      mostRecentTripRange.end,
    );
  }
  if (!leafletMap) {
    // First time: create the map
    if (plannedOnlyToggle.checked) {
      leafletMap = initMap(stops, [], logs);
    } else {
      leafletMap = initMap(stops, places, logs);
    }
  } else {
    // Map exists: just update log layer and planned/places markers
    initMap(stops, plannedOnlyToggle.checked ? [] : places, logs);
  }
}

function getMostRecentTripRangeFromTrips(trips) {
  // Flatten all trips into one array if grouped by year
  let allTrips = [];
  if (Array.isArray(trips)) {
    if (trips.length && Array.isArray(trips[0].trips)) {
      trips.forEach((group) => allTrips.push(...group.trips));
    } else {
      allTrips = trips;
    }
  }
  // Sort by start date descending
  allTrips = allTrips
    .filter((t) => t.start)
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
    if (currentLogFilter === "all") {
      logsToShow = allLogsCache;
    } else if (currentLogFilter && currentLogFilter.start) {
      logsToShow = filterLogsByDate(
        allLogsCache,
        currentLogFilter.start,
        currentLogFilter.end,
      );
    } else if (mostRecentTripRange && mostRecentTripRange.start) {
      logsToShow = filterLogsByDate(
        allLogsCache,
        mostRecentTripRange.start,
        mostRecentTripRange.end,
      );
    }
    renderHistoricalLog(logsToShow, stops);
    renderLogSummary(logsToShow);
    renderBrokenItems(logsToShow);
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
      currentLogFilter = "all";
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
  return logs.filter((l) => {
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
          const speed =
            parseFloat(document.getElementById("speed-input").value) || 0;
          const plannedOnlyToggle = document.getElementById(
            "planned-only-toggle",
          );
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
  document.querySelectorAll(".historical-trip-link").forEach((li) => {
    li.addEventListener("click", () => {
      // Switch to log tab
      document.querySelectorAll(".tab-nav button").forEach((btn) => {
        btn.classList.remove("active");
        if (btn.dataset.tab === "log") btn.classList.add("active");
      });
      document
        .querySelectorAll(".tab-content")
        .forEach((sec) => sec.classList.add("hidden"));
      document.getElementById("log").classList.remove("hidden");

      // Filter logs for this trip
      const start = li.getAttribute("data-trip-start");
      const end = li.getAttribute("data-trip-end");
      currentLogFilter = { start, end };
      const filtered = filterLogsByDate(allLogsCache, start, end);
      renderHistoricalLog(filtered, stops);
      renderLogSummary(filtered);
      renderBrokenItems(filtered);
      renderLogMap(filtered, stops);
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
  setupLogTab(stops);
  setupHistoricalTripLinks(stops);

  // Update on speed change:
  speedInput.addEventListener("input", () => {
    const speed = parseFloat(speedInput.value) || 0;
    renderTable(stops, speed);
  });

  plannedOnlyToggle.addEventListener("change", renderMapWithToggle);

  initTabs();
}

document.addEventListener("DOMContentLoaded", init);
document.addEventListener("DOMContentLoaded", function () {
  const userBtn = document.getElementById("user-menu-btn");
  const dropdown = document.getElementById("user-dropdown");
  if (userBtn && dropdown) {
    userBtn.addEventListener("click", (e) => {
      e.preventDefault();
      dropdown.style.display =
        dropdown.style.display === "block" ? "none" : "block";
    });
    // Hide dropdown when clicking outside
    document.addEventListener("click", (e) => {
      if (!userBtn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = "none";
      }
    });
  }
});
