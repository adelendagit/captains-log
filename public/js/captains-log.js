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

    console.log(`Stop "${s.name}" rating=${s.rating} → color=${color}`);

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
              `Rating: ${s.rating ?? "–"}/5`),
      );
  });

  // fit to stops only
  if (stopCoords.length) {
    map.fitBounds(stopCoords, { padding: [40, 40] });
  }

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
  const tableEl = document.getElementById("planning-table");
  tableEl.innerHTML = `
    <thead>
      <tr>
        <th>Stop</th>
        <th>Distance (NM)</th>
        <th>ETA</th>
        <th>Stay</th>
        <th>Navily</th>
        <th>Trello</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = tableEl.querySelector("tbody");

  const current = stops.find((s) => s.dueComplete);
  let prevStop = current;
  if (current) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>Current: ${current.name}</td>
      <td></td><td></td><td></td>
      <td>${current.navilyUrl ? `<a href="${current.navilyUrl}" target="_blank">Link</a>` : ""}</td>
      <td><a href="${current.trelloUrl}" target="_blank">Link</a></td>
    `;
    tbody.appendChild(tr);
  }

  const future = stops.filter((s) => !s.dueComplete);
  future.forEach((s, idx) => {
    const next = future[idx + 1];
    if (next) {
      const diff = new Date(next.due) - new Date(s.due);
      s.hoursToNext = diff / 3600000;
      s.overnight = next.due.slice(0, 10) !== s.due.slice(0, 10);
    } else {
      s.hoursToNext = null;
      s.overnight = false;
    }
  });

  const byDay = future.reduce((acc, s) => {
    const day = s.due.slice(0, 10);
    (acc[day] ??= []).push(s);
    return acc;
  }, {});

  Object.keys(byDay)
    .sort()
    .forEach((dayKey) => {
      const dayRow = document.createElement("tr");
      dayRow.className = "day-row";
      const th = document.createElement("th");
      th.colSpan = 6;
      th.textContent = new Date(dayKey).toLocaleDateString();
      dayRow.appendChild(th);
      tbody.appendChild(dayRow);

      byDay[dayKey].forEach((s) => {
        let distance = "";
        let eta = "";
        if (prevStop) {
          const meters = haversine(prevStop.lat, prevStop.lng, s.lat, s.lng);
          const nm = toNM(meters);
          distance = nm.toFixed(1);
          eta = formatDuration(nm / speed);
        }

        let stay = "";
        if (s.hoursToNext != null) {
          const hrs = Math.round(s.hoursToNext);
          stay = `${hrs}h ${s.overnight ? "Overnight" : "Lunchtime swim"}`;
        }

        const tr = document.createElement("tr");
        if (s.overnight) tr.classList.add("overnight");
        tr.innerHTML = `
        <td>${s.name}</td>
        <td>${distance}</td>
        <td>${eta}</td>
        <td>${stay}</td>
        <td>${s.navilyUrl ? `<a href="${s.navilyUrl}" target="_blank">Link</a>` : ""}</td>
        <td><a href="${s.trelloUrl}" target="_blank">Link</a></td>
      `;
        tbody.appendChild(tr);
        prevStop = s;
      });
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
    });
  });
}

async function init() {
  const { stops, places } = await fetchData(); // server has already excluded Trips
  console.log("Planned stops:", stops);

  const speedInput = document.getElementById("speed-input");
  initMap(stops, places);
  renderList(stops, parseFloat(speedInput.value));

  speedInput.addEventListener("input", () => {
    renderList(stops, parseFloat(speedInput.value) || 0);
  });

  initTabs();
}

document.addEventListener("DOMContentLoaded", init);
