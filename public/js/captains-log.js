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
let logRenderScheduled = false;

let canPlan = false;
let boardLabels = [];
let currentStatus = null;
let underwayMarker = null;
let underwayInterval = null;
let locationLogDraft = null;
let locationLogSuggestions = [];

const LOCATION_LOG_ACTIONS = {
  arrived: "Arrived",
  departed: "Departed",
  water: "Water",
  diesel: "Diesel",
  bins: "Bins",
  "bbq-gas-change": "BBQ Gas Change",
  "gas-tank-change": "Gas Tank Change",
  power: "Power",
  boom: "Boom",
};

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

function getExpectedPosition(from, to, departedAt, speed) {
  const totalMeters = haversine(from.lat, from.lng, to.lat, to.lng);
  const totalNm = toNM(totalMeters);
  const hours = (Date.now() - new Date(departedAt)) / 36e5;
  const traveledNm = hours * speed;
  const frac = totalNm > 0 ? Math.min(traveledNm / totalNm, 1) : 0;
  return {
    lat: from.lat + (to.lat - from.lat) * frac,
    lng: from.lng + (to.lng - from.lng) * frac,
    fraction: frac,
  };
}
function formatDuration(h) {
  const hh = Math.floor(h),
    mm = Math.round((h - hh) * 60);
  return `${hh}h ${mm}m`;
}

function formatDurationRounded(h) {
  if (!isFinite(h)) return "";
  let totalMinutes;
  if (h * 60 < 15) {
    // For durations under 15 minutes, round to nearest 5 minutes
    totalMinutes = Math.round((h * 60) / 5) * 5;
  } else {
    // Otherwise, round to nearest 15 minutes
    totalMinutes = Math.round((h * 60) / 15) * 15;
  }
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

  // Consider only upcoming stops with a due date
  const future = stops
    .filter((s) => !s.dueComplete && s.due)
    .sort((a, b) => new Date(a.due) - new Date(b.due));

  // --- Totals for distance ---
  let prev = null;
  if (currentStatus) {
    if (currentStatus.status === "arrived" && currentStatus.current) {
      prev =
        stops.find((s) => s.id === currentStatus.current.id) ||
        currentStatus.current;
    } else if (currentStatus.status === "underway" && currentStatus.from) {
      prev =
        stops.find((s) => s.id === currentStatus.from.id) || currentStatus.from;
    }
  } else {
    prev = stops.find((s) => s.dueComplete) || null;
  }

  let totalNM = 0;
  future.forEach((s) => {
    if (prev) {
      const meters = haversine(prev.lat, prev.lng, s.lat, s.lng);
      totalNM += toNM(meters);
    }
    prev = s;
  });

  // --- Additional stats ---
  const totalStops = future.length;
  let totalDays = 0;
  if (future.length > 0) {
    const first = new Date(future[0].due);
    const last = new Date(future[future.length - 1].due);
    totalDays = Math.round((last - first) / 86400000) + 1;
  }

  const totalH = totalNM / speed;

  summaryEl.innerHTML = `
    <div class="summary-item"><i class="fa-solid fa-location-dot"></i><span>${totalStops} stops</span></div>
    <div class="summary-item"><i class="fa-solid fa-calendar-days"></i><span>${totalDays} days away</span></div>
    <div class="summary-item"><i class="fa-solid fa-route"></i><span>${totalNM.toFixed(1)} NM</span></div>
    <div class="summary-item"><i class="fa-solid fa-clock"></i><span>${formatDurationRounded(totalH)}</span></div>
  `;
}

async function fetchData() {
  const [dataRes, statusRes] = await Promise.all([
    fetch("/api/data"),
    fetch("/api/current-stop"),
  ]);
  const data = await dataRes.json();
  canPlan = data.canPlan;
  boardLabels = data.boardLabels || [];
  let statusJson = null;
  try {
    statusJson = await statusRes.json();
  } catch (e) {
    statusJson = { status: "unknown" };
  }
  return { ...data, currentStatus: statusJson };
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

function labelsToHtml(labelsArr) {
  const html = labelsArr
    .filter((lab) => lab.name && lab.name.toLowerCase() !== "visited")
    .map((lab) => {
      const bg = lab.color || "#888";
      const fg = badgeTextColor(bg);
      return `<span class="label" style="background:${bg};color:${fg}">${lab.name}</span>`;
    })
    .join("");
  return html || `<span class="label placeholder">Add label</span>`;
}

let labelEditorEl = null;
function showLabelEditor(targetEl, cardId, currentIds) {
  if (labelEditorEl) labelEditorEl.remove();
  labelEditorEl = document.createElement("div");
  labelEditorEl.className = "label-editor";

  const sorted = [...boardLabels].sort((a, b) => {
    const colorA = a.color || "";
    const colorB = b.color || "";
    if (colorA === colorB) {
      return (a.name || "").localeCompare(b.name || "");
    }
    return colorA.localeCompare(colorB);
  });

  sorted.forEach((lab) => {
    const id = `label-edit-${lab.id}`;
    const wrapper = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = lab.id;
    cb.id = id;
    if (currentIds.includes(lab.id)) cb.checked = true;
    const span = document.createElement("span");
    span.className = "label";
    span.textContent = lab.name;
    span.style.background = lab.color || "#888";
    span.style.color = badgeTextColor(lab.color || "#888");
    wrapper.appendChild(cb);
    wrapper.appendChild(span);
    labelEditorEl.appendChild(wrapper);

    cb.addEventListener("change", async () => {
      const selected = Array.from(
        labelEditorEl.querySelectorAll("input[type=checkbox]:checked"),
      ).map((input) => input.value);
      const res = await fetch("/api/update-labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId, labels: selected }),
      });
      if (res.ok) {
        const newLabels = boardLabels.filter((l) => selected.includes(l.id));
        targetEl.innerHTML = labelsToHtml(newLabels);
        const stop = stops.find((s) => s.id === cardId);
        if (stop) stop.labels = newLabels;
        if (lastLoadedLogs) {
          lastLoadedLogs.forEach((log) => {
            if (log.cardId === cardId) log.labels = newLabels;
          });
        }
      } else {
        alert("Failed to update labels");
        cb.checked = !cb.checked;
      }
    });
  });

  const rect = targetEl.getBoundingClientRect();
  labelEditorEl.style.top = `${rect.bottom + window.scrollY}px`;
  labelEditorEl.style.left = `${rect.left + window.scrollX}px`;
  document.body.appendChild(labelEditorEl);

  setTimeout(() => {
    document.addEventListener("click", function handler(e) {
      if (
        labelEditorEl &&
        !labelEditorEl.contains(e.target) &&
        e.target !== targetEl
      ) {
        labelEditorEl.remove();
        labelEditorEl = null;
        document.removeEventListener("click", handler);
      }
    });
  }, 0);
}

async function preloadAllLogs() {
  if (window.EventSource) {
    const source = new EventSource("/api/logs/stream?trip=all");
    source.addEventListener("batch", (event) => {
      const payload = JSON.parse(event.data);
      if (allLogsCache === null) {
        allLogsCache = [];
      }
      if (Array.isArray(payload.logs)) {
        allLogsCache.push(...payload.logs);
      }
      if (payload.mostRecentTripRange) {
        mostRecentTripRange = payload.mostRecentTripRange;
      }
      scheduleLogRender();
    });
    source.addEventListener("done", () => {
      if (allLogsCache === null) {
        allLogsCache = [];
      }
      scheduleLogRender();
      source.close();
    });
    source.onerror = (err) => {
      console.error("Failed to stream logs:", err);
      source.close();
      if (allLogsCache === null) {
        allLogsCache = [];
      }
      scheduleLogRender();
    };
    return;
  }
  try {
    const res = await fetch("/api/logs?trip=all");
    if (!res.ok) throw new Error("Network response not ok");
    const json = await res.json();
    allLogsCache = json.logs || [];
    mostRecentTripRange = json.mostRecentTripRange || null;
    scheduleLogRender();
  } catch (err) {
    console.error("Failed to preload logs:", err);
    allLogsCache = [];
  }
}

function isLogTabActive() {
  const logSection = document.getElementById("log");
  return logSection && !logSection.classList.contains("hidden");
}

function scheduleLogRender() {
  if (logRenderScheduled) return;
  logRenderScheduled = true;
  requestAnimationFrame(() => {
    logRenderScheduled = false;
    if (isLogTabActive()) {
      renderFilteredLogs(stops);
    }
    if (leafletMap) {
      renderMapWithToggle();
    }
  });
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

  const mapStops = [...stops];
  let highlightId = null;
  if (currentStatus) {
    if (currentStatus.status === "arrived" && currentStatus.current) {
      highlightId = currentStatus.current.id;
      if (!mapStops.some((s) => s.id === highlightId)) {
        mapStops.unshift(currentStatus.current);
      }
    } else if (currentStatus.status === "underway" && currentStatus.from) {
      highlightId = currentStatus.from.id;
      if (!mapStops.some((s) => s.id === highlightId)) {
        mapStops.unshift(currentStatus.from);
      }
    }
  }

  const stopCoords = [];

  // plot planned stops only
  mapStops.forEach((s) => {
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

    const isHighlight = highlightId && s.id === highlightId;
    L.circleMarker(ll, {
      radius: 14,
      fillColor: color,
      color: isHighlight ? "#0077cc" : "#cac8c8ff",
      weight: isHighlight ? 4 : 3,
      fillOpacity: 0.88,
      opacity: 1,
      className: isHighlight
        ? "map-stop-marker map-current-marker"
        : "map-stop-marker",
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
    // Find all arrived/visited logs, unique by cardId
    const arrived = logs
      .filter((l) => l.type === "Arrived" || l.type === "Visited")
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
      typeof firstDeparted.lng === "number" //&&
      //!seen.has(firstDeparted.cardId)
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

  if (underwayMarker) {
    map.removeLayer(underwayMarker);
    underwayMarker = null;
  }
  if (underwayInterval) {
    clearInterval(underwayInterval);
    underwayInterval = null;
  }

  function updateUnderwayMarker() {
    if (underwayMarker) {
      map.removeLayer(underwayMarker);
      underwayMarker = null;
    }
    if (
      currentStatus &&
      currentStatus.status === "underway" &&
      currentStatus.from &&
      currentStatus.destination &&
      currentStatus.departedAt
    ) {
      const speed =
        parseFloat(document.getElementById("speed-input").value) || 0;
      if (speed > 0) {
        const pos = getExpectedPosition(
          currentStatus.from,
          currentStatus.destination,
          currentStatus.departedAt,
          speed,
        );
        underwayMarker = L.marker([pos.lat, pos.lng], {
          icon: L.divIcon({ className: "underway-marker", html: "⛵" }),
        }).addTo(map);
      }
    }
  }

  updateUnderwayMarker();
  underwayInterval = setInterval(updateUnderwayMarker, 60000);

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
        // Find the latest due date (if any)
        const lastDue = stops
          .filter((s) => s.due)
          .map((s) => new Date(s.due))
          .sort((a, b) => b - a)[0];

        // If there are no currently planned stops, start from today
        const nextDue = lastDue ? new Date(lastDue) : new Date();
        // Plan for the following day
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
            currentStatus = data.currentStatus;
            boardLabels = data.boardLabels || boardLabels;
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
          currentStatus = data.currentStatus;
          boardLabels = data.boardLabels || boardLabels;
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
        container.querySelectorAll(".star").forEach((star) => {
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
              container.querySelectorAll(".star").forEach((s) => {
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
      // Find the latest due date (if any)
      const lastDue = stops
        .filter((s) => s.due)
        .map((s) => new Date(s.due))
        .sort((a, b) => b - a)[0];

      // Start from today if no stops are currently planned
      const nextDue = lastDue ? new Date(lastDue) : new Date();
      // Move to the following day for the new stop
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
        currentStatus = data.currentStatus;
        boardLabels = data.boardLabels || boardLabels;
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
        currentStatus = data.currentStatus;
        boardLabels = data.boardLabels || boardLabels;
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

  let current = null;
  let departed = null;
  if (currentStatus) {
    if (currentStatus.status === "arrived" && currentStatus.current) {
      current =
        stops.find((s) => s.id === currentStatus.current.id) ||
        currentStatus.current;
    } else if (currentStatus.status === "underway" && currentStatus.from) {
      departed =
        stops.find((s) => s.id === currentStatus.from.id) || currentStatus.from;
    }
  } else {
    current = stops.find((s) => s.dueComplete) || null;
  }

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
      <td colspan="3">${links}</td>
    `;
    tbody.appendChild(tr);
  } else if (departed) {
    const nextStop = currentStatus.destination
      ? stops.find((s) => s.id === currentStatus.destination.id) ||
        currentStatus.destination
      : null;
    const speed = parseFloat(document.getElementById("speed-input").value) || 0;
    const departedAt = currentStatus.departedAt
      ? new Date(currentStatus.departedAt)
      : null;

    let posHtml = "";
    let etaHtml = "";
    let durationHtml = "";
    if (departedAt) {
      durationHtml = formatDurationRounded((Date.now() - departedAt) / 36e5);
    }
    if (speed > 0 && departedAt && nextStop) {
      const pos = getExpectedPosition(
        currentStatus.from,
        nextStop,
        currentStatus.departedAt,
        speed,
      );
      posHtml = `${pos.lat.toFixed(2)}, ${pos.lng.toFixed(2)}`;

      const totalMeters = haversine(
        currentStatus.from.lat,
        currentStatus.from.lng,
        nextStop.lat,
        nextStop.lng,
      );
      const totalNm = toNM(totalMeters);
      const traveledNm = pos.fraction * totalNm;
      const remainingNm = totalNm - traveledNm;
      const etaDate = new Date(Date.now() + (remainingNm / speed) * 36e5);
      etaHtml = etaDate.toLocaleString();
    }

    const tr = document.createElement("tr");
    tr.className = "current-stop-row underway-row";
    tr.innerHTML = `
      <td colspan="6">
        <div class="underway-info">
          <span class="current-badge-table underway-badge">Underway</span>
          ${nextStop ? `<div>Heading to ${nextStop.name}</div>` : ""}
          ${
            departedAt
              ? `<div>Departed: ${departedAt.toLocaleString()}</div>`
              : ""
          }
          ${posHtml ? `<div>Estimated position: ${posHtml}</div>` : ""}
          ${etaHtml ? `<div>ETA: ${etaHtml}</div>` : ""}
          ${durationHtml ? `<div>Time underway: ${durationHtml}</div>` : ""}
        </div>
      </td>
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

  let prevStop = current || departed;
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
      const dayRows = [];
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

      let dayTotalNMValue =
        dayTotalNM >= 1
          ? Math.round(dayTotalNM).toString()
          : dayTotalNM.toFixed(1);

      const dayRow = document.createElement("tr");
      dayRow.className = "day-header-row";
      dayRow.setAttribute("data-day", dayKey);
      dayRow.innerHTML = `<td colspan="6" class="day-header-table">
        ${formatDayLabel(dayKey)}
        <span class="day-totals">
          &nbsp;•&nbsp;${dayTotalNMValue} NM
          ${dayTotalH ? `&nbsp;•&nbsp;${formatDurationRounded(dayTotalH)}` : ""}
        </span>
      </td>`;
      tbody.appendChild(dayRow);
      dayRows.push(dayRow);

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
            let nmValue = toNM(meters);
            nm =
              nmValue >= 1
                ? Math.round(nmValue).toString()
                : nmValue.toFixed(1);
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
          <td>${nm} NM&nbsp;•&nbsp;${eta}</td>
          <td>${links}</td>
        `;
        tbody.appendChild(tr);
        dayRows.push(tr);
        prevStop = s;
      });

      // If no stops for this day, add an empty row for drag-and-drop (only for logged-in users)
      if (stopsForDay.length === 0 && canPlan) {
        const tr = document.createElement("tr");
        tr.className = "sortable-stop-row empty-drop-row";
        tr.setAttribute("data-day", dayKey);
        tr.innerHTML = `<td colspan="6" style="text-align:center; color:#bbb; font-style:italic;">No plans...</td>`;
        tbody.appendChild(tr);
        dayRows.push(tr);
      }

      const lastRow = dayRows[dayRows.length - 1];
      if (lastRow) lastRow.classList.add("day-end-row");
    }
    if (canPlan) {
      document.querySelectorAll(".stars.editable").forEach((container) => {
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
          currentStatus = data.currentStatus;
          boardLabels = data.boardLabels || boardLabels;
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

  // Find all arrived or visited logs
  const arrived = logs
    .filter((l) => l.type === "Arrived" || l.type === "Visited")
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
      <div class="historical-log-date">${new Date(l.timestamp).toLocaleDateString([], { day: "numeric", month: "short" })} ${new Date(l.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
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

  const chron = [...logs].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
  );

  let totalNM = 0;
  let totalHrs = 0;
  let lastDepart = null;
  let lastArrive = null;
  let longestStay = 0;
  let longestStayName = null;
  const stopSet = new Set();
  let lastPoint = null;

  chron.forEach((l) => {
    if (l.type === "Departed") {
      if (lastArrive) {
        const stay =
          (new Date(l.timestamp) - new Date(lastArrive.timestamp)) / 86400000;
        if (stay > longestStay) {
          longestStay = stay;
          longestStayName = lastArrive.cardName;
        }
        lastArrive = null;
      }
      if (l.lat != null && l.lng != null) {
        lastDepart = l;
        lastPoint = l;
      }
    } else if (l.type === "Visited") {
      if (
        lastPoint &&
        lastPoint.lat != null &&
        lastPoint.lng != null &&
        l.lat != null &&
        l.lng != null
      ) {
        const meters = haversine(lastPoint.lat, lastPoint.lng, l.lat, l.lng);
        totalNM += toNM(meters);
      }
      if (l.lat != null && l.lng != null) {
        lastPoint = l;
      }
    } else if (l.type === "Arrived") {
      stopSet.add(l.cardId || l.cardName);
      if (
        lastPoint &&
        lastPoint.lat != null &&
        lastPoint.lng != null &&
        l.lat != null &&
        l.lng != null
      ) {
        const meters = haversine(lastPoint.lat, lastPoint.lng, l.lat, l.lng);
        totalNM += toNM(meters);
      }
      if (lastDepart) {
        const hrs =
          (new Date(l.timestamp) - new Date(lastDepart.timestamp)) / 3600000;
        if (isFinite(hrs)) totalHrs += hrs;
      }
      lastArrive = l;
      lastDepart = null;
      lastPoint = l;
    }
  });

  const arrivals = chron.filter((l) => l.type === "Arrived");
  let totalDays = 0;
  if (arrivals.length > 0) {
    const first = new Date(arrivals[0].timestamp);
    const last = new Date(arrivals[arrivals.length - 1].timestamp);
    totalDays = Math.round((last - first) / 86400000) + 1;
  }

  const longestStayText =
    longestStayName != null
      ? `${longestStay.toFixed(1)} days in ${longestStayName}`
      : "N/A";

  div.innerHTML = `
    <div class="summary-item"><i class="fa-solid fa-location-dot"></i><span>${stopSet.size} stops</span></div>
    <div class="summary-item"><i class="fa-solid fa-calendar-days"></i><span>${totalDays} days away</span></div>
    <div class="summary-item"><i class="fa-solid fa-route"></i><span>${totalNM.toFixed(1)} NM</span></div>
    <div class="summary-item"><i class="fa-solid fa-bed"></i><span>Longest stay: ${longestStayText}</span></div>
    <div class="summary-item"><i class="fa-solid fa-clock"></i><span>${formatDurationRounded(totalHrs)}</span></div>
  `;
}

function renderDieselInfo(logs = []) {
  const div = document.getElementById("diesel-info");
  if (!div) return;

  const TANK_CAPACITY = 140; // litres
  let fuelRemaining = TANK_CAPACITY;
  let distanceSinceFill = 0;
  let lastEfficiency = null;
  let lastFill = null;
  let lastDepart = null;
  let totalBurnt = 0;
  let lastPoint = null;

  const chron = [...logs].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
  );

  chron.forEach((l) => {
    if (l.type === "Departed" && l.lat != null && l.lng != null) {
      lastDepart = l;
      lastPoint = l;
    } else if (
      l.type === "Visited" &&
      lastPoint &&
      lastPoint.lat != null &&
      lastPoint.lng != null &&
      l.lat != null &&
      l.lng != null
    ) {
      const meters = haversine(lastPoint.lat, lastPoint.lng, l.lat, l.lng);
      const nm = toNM(meters);
      distanceSinceFill += nm;
      if (lastEfficiency) {
        fuelRemaining -= nm / lastEfficiency;
      }
      lastPoint = l;
    } else if (
      l.type === "Arrived" &&
      lastPoint &&
      lastPoint.lat != null &&
      lastPoint.lng != null &&
      l.lat != null &&
      l.lng != null
    ) {
      const meters = haversine(lastPoint.lat, lastPoint.lng, l.lat, l.lng);
      const nm = toNM(meters);
      distanceSinceFill += nm;
      if (lastEfficiency) {
        fuelRemaining -= nm / lastEfficiency;
      }
      lastDepart = null;
      lastPoint = null;
    } else if (l.type === "Diesel" && typeof l.dieselLitres === "number") {
      if (distanceSinceFill > 0 && l.dieselLitres > 0) {
        lastEfficiency = distanceSinceFill / l.dieselLitres;
      }
      totalBurnt += l.dieselLitres;
      fuelRemaining = TANK_CAPACITY;
      distanceSinceFill = 0;
      lastFill = { timestamp: l.timestamp, litres: l.dieselLitres };
    }
  });

  fuelRemaining = Math.max(0, Math.min(TANK_CAPACITY, fuelRemaining));
  const burntSinceLastFill = TANK_CAPACITY - fuelRemaining;
  totalBurnt += burntSinceLastFill;
  const range = lastEfficiency ? fuelRemaining * lastEfficiency : null;

  if (!lastEfficiency) {
    div.innerHTML = "<h4>Diesel</h4><p>Not enough data to estimate usage.</p>";
    return;
  }

  const pct = fuelRemaining / TANK_CAPACITY;
  const angle = pct * 180 - 90; // -90 is empty, +90 is full
  const arcTotal = 126; // approximate path length of the semicircle
  const arcLen = pct * arcTotal;

  div.innerHTML = `
    <h4>Diesel</h4>
    <div class="diesel-gauge-container">
      <svg viewBox="0 0 100 60" class="diesel-gauge">
        <path class="gauge-bg" d="M10 50 a40 40 0 0 1 80 0" />
        <path class="gauge-fill" d="M10 50 a40 40 0 0 1 80 0" style="stroke-dasharray:${arcLen.toFixed(1)} ${arcTotal}" />
        <line class="gauge-needle" x1="50" y1="50" x2="50" y2="15" transform="rotate(${angle} 50 50)" />
        <text x="10" y="58" class="gauge-label">E</text>
        <text x="90" y="58" text-anchor="end" class="gauge-label">F</text>
      </svg>
      <div class="gauge-center">${fuelRemaining.toFixed(1)}L</div>
    </div>
    <ul class="diesel-stats">
      <li><span class="label">Last fill</span><span class="value">${
        lastFill
          ? new Date(lastFill.timestamp).toLocaleDateString() +
            (lastFill.litres != null ? ` (${lastFill.litres} litres)` : "")
          : "N/A"
      }</span></li>
      <li><span class="label">Fuel economy</span><span class="value">${lastEfficiency.toFixed(2)} NM/litre</span></li>
      <li><span class="label">Diesel burnt</span><span class="value">${totalBurnt.toFixed(1)} litres</span></li>
      <li><span class="label">Diesel left</span><span class="value">${fuelRemaining.toFixed(1)} litres</span></li>
      <li><span class="label">Estimated range</span><span class="value">${
        range != null ? range.toFixed(1) + " NM" : "N/A"
      }</span></li>
    </ul>
  `;
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
    .map(
      (e) => `
      <li class="broken-item">
        <span class="item-name">${e.item}</span>
        <span class="status ${e.fixed ? "fixed" : "broken"}">
          <i class="fa-solid ${e.fixed ? "fa-check" : "fa-circle-xmark"}"></i>
          ${e.fixed ? "Fixed" : "Broken"}
        </span>
      </li>`,
    )
    .join("");
  div.innerHTML = `<h4>Broken Items</h4><ul class="broken-items-list">${list}</ul>`;
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
    .filter((l) => l.type === "Arrived" || l.type === "Visited")
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
    typeof firstDeparted.lng === "number" //&&
    //!seen.has(firstDeparted.cardId)
  ) {
    // Always add the first departed point at the start, even if cardId matches
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

function renderFilteredLogs(stops = []) {
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
  renderDieselInfo(logsToShow);
  renderBrokenItems(logsToShow);
  window._lastLogMapData = logsToShow;

  // --- ADD THIS: update the map if the log tab is visible ---
  if (isLogTabActive()) {
    renderLogMap(logsToShow, stops);
  }
}

function setupLogTab(stops = []) {
  const tabSelector = '[data-tab="log"]';
  const btn = document.querySelector(tabSelector);
  if (!btn) return;

  const showAllBtn = document.getElementById("show-all-logs-btn");
  const showLastTripBtn = document.getElementById("show-last-trip-btn");

  btn.addEventListener("click", () => {
    currentLogFilter = null; // reset to most recent trip
    renderFilteredLogs(stops);
  });

  if (showAllBtn) {
    showAllBtn.addEventListener("click", () => {
      currentLogFilter = "all";
      renderFilteredLogs(stops);
    });
  }

  if (showLastTripBtn) {
    showLastTripBtn.addEventListener("click", () => {
      currentLogFilter = null; // null means "most recent trip"
      renderFilteredLogs(stops);
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

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported on this device."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000,
    });
  });
}

function renderLocationSuggestions(suggestions = [], selectedId = null) {
  const container = document.getElementById("location-log-suggestions");
  if (!container) return;

  if (!suggestions.length) {
    container.innerHTML = `<p class="muted">No nearby locations found. Choose a card manually in Trello.</p>`;
    return;
  }

  container.innerHTML = suggestions
    .map((s) => {
      const checked = selectedId === s.id ? "checked" : "";
      const dist = Number.isFinite(s.distanceKm)
        ? `${s.distanceKm.toFixed(1)} km`
        : "";
      return `
        <label class="location-option">
          <input type="radio" name="location-log-card" value="${s.id}" ${checked}>
          <span><strong>${s.name}</strong> <small>${s.list || ""} ${dist}</small></span>
        </label>
      `;
    })
    .join("");
}

function setupLocationLogControls() {
  const detectBtn = document.getElementById("detect-location-log-btn");
  const submitBtn = document.getElementById("submit-location-log-btn");
  const statusEl = document.getElementById("location-log-status");
  const actionEl = document.getElementById("location-log-action");
  const litresWrap = document.getElementById("location-log-litres-wrap");
  const litresEl = document.getElementById("location-log-litres");
  const backfillBtn = document.getElementById("location-log-backfill-btn");
  const backfillWrap = document.getElementById("location-log-backfill-wrap");
  const backfillTimeEl = document.getElementById("location-log-backfill-time");

  if (!detectBtn || !submitBtn || !statusEl || !actionEl) return;

  const toggleLitres = () => {
    const needsLitres = ["water", "diesel"].includes(actionEl.value);
    if (litresWrap) litresWrap.hidden = !needsLitres;
    if (!needsLitres && litresEl) litresEl.value = "";
  };

  const toggleBackfill = () => {
    if (!backfillWrap) return;
    backfillWrap.hidden = !backfillWrap.hidden;
    if (!backfillWrap.hidden && backfillTimeEl && !backfillTimeEl.value) {
      const now = new Date();
      now.setSeconds(0, 0);
      backfillTimeEl.value = now.toISOString().slice(0, 16);
    }
  };

  actionEl.addEventListener("change", toggleLitres);
  toggleLitres();

  if (backfillBtn) {
    backfillBtn.addEventListener("click", toggleBackfill);
  }

  detectBtn.addEventListener("click", async () => {
    statusEl.textContent = "Detecting your location…";
    submitBtn.disabled = true;

    try {
      const position = await getCurrentPosition();
      const payload = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };
      if (Number.isFinite(position.coords.speed)) {
        payload.speedKts = Math.max(position.coords.speed * 1.94384, 0);
      }

      const contextRes = await fetch("/api/log-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const context = await contextRes.json();
      if (!contextRes.ok) {
        throw new Error(context.error || "Unable to detect location context.");
      }

      locationLogDraft = context.draft;
      locationLogSuggestions = context.suggestions || [];
      renderLocationSuggestions(
        locationLogSuggestions,
        locationLogDraft?.cardId || null,
      );

      if (
        locationLogDraft?.action &&
        actionEl.querySelector(`option[value="${locationLogDraft.action}"]`)
      ) {
        actionEl.value = locationLogDraft.action;
        toggleLitres();
      }

      const modeText =
        context.mode === "underway"
          ? "You appear to be underway. Confirm location and action, then submit."
          : "You appear to be in port. Select the location and action, then submit.";
      statusEl.textContent = modeText;
      submitBtn.disabled = false;
    } catch (error) {
      statusEl.textContent = error.message || "Unable to detect location.";
      renderLocationSuggestions([], null);
    }
  });

  submitBtn.addEventListener("click", async () => {
    if (!locationLogDraft) return;

    const selected = document.querySelector(
      'input[name="location-log-card"]:checked',
    );
    const cardId = selected ? selected.value : locationLogDraft.cardId;
    if (!cardId) {
      statusEl.textContent = "Please choose a location before posting.";
      return;
    }

    const selectedAction = actionEl.value;
    if (!LOCATION_LOG_ACTIONS[selectedAction]) {
      statusEl.textContent = "Please choose a valid action.";
      return;
    }

    const payload = {
      action: selectedAction,
      cardId,
      lat: locationLogDraft.lat,
      lng: locationLogDraft.lng,
      timestamp: locationLogDraft.timestamp,
      source: "web-ui",
    };

    if (
      litresEl &&
      ["water", "diesel"].includes(selectedAction) &&
      litresEl.value !== ""
    ) {
      payload.litres = litresEl.value;
    }

    if (
      backfillWrap &&
      !backfillWrap.hidden &&
      backfillTimeEl &&
      backfillTimeEl.value
    ) {
      payload.timestamp = new Date(backfillTimeEl.value).toISOString();
    }

    submitBtn.disabled = true;
    statusEl.textContent = "Posting comment…";

    try {
      const res = await fetch("/api/log-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to post log comment.");
      }

      statusEl.textContent = "Log comment posted successfully.";
      currentStatus = await (await fetch("/api/current-stop")).json();
      renderTable(
        stops,
        parseFloat(document.getElementById("speed-input").value) || 0,
      );
      submitBtn.disabled = false;
    } catch (error) {
      statusEl.textContent = error.message || "Failed to post log comment.";
      submitBtn.disabled = false;
    }
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
        if (underwayInterval) {
          clearInterval(underwayInterval);
          underwayInterval = null;
        }
        underwayMarker = null;
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
      renderDieselInfo(filtered);
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
  currentStatus = data.currentStatus;
  boardLabels = data.boardLabels || boardLabels;

  const speedInput = document.getElementById("speed-input");
  plannedOnlyToggle = document.getElementById("planned-only-toggle");

  // When there are no planned stops, show all places so users can plan the first one
  if (stops.length === 0) {
    plannedOnlyToggle.checked = false;
  }

  renderMapWithToggle();
  renderTable(stops, parseFloat(speedInput.value));
  setupLogTab(stops);
  setupHistoricalTripLinks(stops);
  setupLocationLogControls();

  // Update on speed change:
  speedInput.addEventListener("input", () => {
    const speed = parseFloat(speedInput.value) || 0;
    renderTable(stops, speed);
    renderMapWithToggle();
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
// Enhanced log rendering with labels and distance
renderHistoricalLog = function (logs = [], stops = []) {
  const section = document.getElementById("log-list");
  if (!section) return;
  section.innerHTML = "";

  const chron = logs
    .filter((l) => l.type === "Arrived" || l.type === "Visited")
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const firstDeparted = logs
    .filter((l) => l.type === "Departed")
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))[0];
  if (firstDeparted) {
    chron.unshift(firstDeparted);
  }

  if (!chron.length) {
    section.innerHTML = "<p>No visits found.</p>";
    return;
  }

  let prev = null;
  chron.forEach((l) => {
    let dist = null;
    if (
      prev &&
      prev.lat != null &&
      prev.lng != null &&
      l.lat != null &&
      l.lng != null
    ) {
      const meters = haversine(prev.lat, prev.lng, l.lat, l.lng);
      dist = toNM(meters);
    }
    l._distanceNm = dist;
    prev = l;
  });

  const header = document.createElement("div");
  header.className = "historical-log-header";
  header.innerHTML = `
    <div>Place</div>
    <div>Distance</div>
    <div>Date</div>
    <div>Rating</div>
    <div>Links</div>
  `;
  section.appendChild(header);

  const displayLogs = [...chron].reverse();

  displayLogs.forEach((l) => {
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
    const labelsArr =
      stop && Array.isArray(stop.labels)
        ? stop.labels
        : Array.isArray(l.labels)
          ? l.labels
          : [];
    const labelsHtml = labelsToHtml(labelsArr);

    let distHtml = "";
    if (l._distanceNm != null) {
      let rounded;
      if (l._distanceNm < 1) {
        rounded = l._distanceNm < 0.75 ? 0.5 : 1;
      } else {
        rounded = Math.round(l._distanceNm);
      }
      const display =
        rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1);
      distHtml = `${display} NM`;
    }
    const d = new Date(l.timestamp);
    const ms = 30 * 60 * 1000; // 30 minutes in ms
    const roundedDate = new Date(Math.round(d.getTime() / ms) * ms);
    const dateStr = roundedDate.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const div = document.createElement("div");
    div.className = "historical-log-entry";
    div.innerHTML = `
      <div class="historical-log-place">${l.cardName}</div>
      <div class="historical-log-distance">${distHtml}</div>
      <div class="historical-log-date">${dateStr}</div>
      <div class="historical-log-rating">${ratingHtml}</div>
      <div class="historical-log-links">${navily}${trello}</div>
      <div class="historical-log-labels">${labelsHtml}</div>
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

      const labelContainer = div.querySelector(".historical-log-labels");
      if (labelContainer) {
        labelContainer.addEventListener("click", (e) => {
          e.stopPropagation();
          const currentIds = labelsArr.map((lab) => lab.id);
          showLabelEditor(labelContainer, l.cardId, currentIds);
        });
      }
    }
  });
};
