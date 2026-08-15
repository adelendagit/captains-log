const authenticated = document.body.dataset.authenticated === "true";
let stopStatus = null;
let stopMap = null;
let stopMarker = null;
let draftCoordinate = null;

function text(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function formatDate(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatPosition(place) {
  if (!Number.isFinite(place?.lat) || !Number.isFinite(place?.lng)) return "Not recorded";
  return `${place.lat.toFixed(5)}°, ${place.lng.toFixed(5)}°`;
}

function setExternalLink(id, url) {
  const link = document.getElementById(id);
  if (!link) return;
  link.classList.toggle("hidden", !url);
  if (url) link.href = url;
}

function renderMap(place, editable = false) {
  if (!Number.isFinite(place?.lat) || !Number.isFinite(place?.lng)) return;
  const coordinate = [place.lat, place.lng];
  draftCoordinate = { lat: place.lat, lng: place.lng };
  if (!stopMap) {
    stopMap = L.map("stop-map", { scrollWheelZoom: false }).setView(coordinate, 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(stopMap);
    stopMarker = L.marker(coordinate, { draggable: editable }).addTo(stopMap);
    stopMarker.on("dragend", () => {
      const point = stopMarker.getLatLng();
      draftCoordinate = { lat: point.lat, lng: point.lng };
      text("stop-coordinate-note", `New position: ${point.lat.toFixed(5)}°, ${point.lng.toFixed(5)}°`);
    });
  } else {
    stopMarker.setLatLng(coordinate);
    stopMap.setView(coordinate, stopMap.getZoom());
    stopMarker.dragging[editable ? "enable" : "disable"]();
  }
  setTimeout(() => stopMap.invalidateSize(), 0);
}

function renderStatus(status) {
  stopStatus = status;
  const place = status.current;
  document.getElementById("stop-loading").classList.add("hidden");
  document.getElementById("stop-empty").classList.toggle("hidden", !(!place || status.status !== "arrived"));
  document.getElementById("stop-overview").classList.toggle("hidden", !place || status.status !== "arrived");
  if (!place || status.status !== "arrived") return;

  text("stop-eyebrow", place.presentation?.mooringSummary ? "Current stop" : "Skibidi is here");
  text("stop-name", place.name);
  text("stop-area", place.listName || "");
  text("stop-arrived", formatDate(status.arrivedAt));
  const visits = Math.max(1, Number(status.visitCount) || 1);
  text("stop-visits", `${visits} ${visits === 1 ? "visit" : "visits"}`);
  text("stop-mooring", status.mooring || place.presentation?.mooringSummary || "Not recorded");
  text("stop-temperature", Number.isFinite(status.temperature) ? `${status.temperature} °C` : "Not recorded");
  text("stop-rating", Number.isFinite(place.rating) ? `${place.rating} / 5` : "Not rated");
  text("stop-position", formatPosition(place));
  text("stop-coordinate-note", authenticated ? "Select Edit to move the pin." : "Approximate logged location.");
  if (authenticated) text("stop-description", place.desc?.trim() || "No description yet.");
  setExternalLink("stop-trello-link", place.trelloUrl);
  setExternalLink("stop-navily-link", place.navilyUrl);

  const labels = document.getElementById("stop-labels");
  labels.replaceChildren(...(place.labels || []).filter((label) => label.name).map((label) => {
    const span = document.createElement("span");
    span.textContent = label.name;
    if (label.color) span.style.setProperty("--label-color", label.color);
    return span;
  }));
  renderMap(place);
}

async function loadStop() {
  try {
    const response = await fetch("/api/current-stop");
    if (!response.ok) throw new Error("Unable to load the current stop");
    renderStatus(await response.json());
  } catch (error) {
    document.getElementById("stop-loading").classList.add("hidden");
    document.getElementById("stop-empty").classList.remove("hidden");
    text("stop-empty", error.message);
  }
}

function defaultPlanDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setMinutes(0, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function setupAuthenticatedActions() {
  if (!authenticated) return;
  const editForm = document.getElementById("stop-edit-form");
  const planForm = document.getElementById("stop-plan-form");
  const editStatus = document.getElementById("stop-edit-status");
  const planStatus = document.getElementById("stop-plan-status");

  document.getElementById("stop-edit-button").addEventListener("click", () => {
    const place = stopStatus?.current;
    if (!place) return;
    document.getElementById("stop-name-input").value = place.name;
    document.getElementById("stop-description-input").value = place.desc || "";
    editStatus.textContent = "";
    editForm.classList.remove("hidden");
    planForm.classList.add("hidden");
    renderMap(place, true);
    editForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.getElementById("stop-edit-cancel").addEventListener("click", () => {
    editForm.classList.add("hidden");
    renderMap(stopStatus.current, false);
    text("stop-coordinate-note", "Select Edit to move the pin.");
  });

  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.getElementById("stop-save-button");
    button.disabled = true;
    editStatus.textContent = "Saving…";
    editStatus.classList.remove("error");
    try {
      const response = await fetch("/api/current-stop", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: document.getElementById("stop-name-input").value,
          description: document.getElementById("stop-description-input").value,
          lat: draftCoordinate.lat,
          lng: draftCoordinate.lng,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to update the stop");
      stopStatus.current = result.place;
      renderStatus(stopStatus);
      editForm.classList.add("hidden");
    } catch (error) {
      editStatus.textContent = error.message;
      editStatus.classList.add("error");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("stop-plan-button").addEventListener("click", () => {
    document.getElementById("stop-plan-date").value = defaultPlanDate();
    planStatus.textContent = "";
    planForm.classList.remove("hidden");
    editForm.classList.add("hidden");
  });
  document.getElementById("stop-plan-cancel").addEventListener("click", () => planForm.classList.add("hidden"));
  planForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = document.getElementById("stop-plan-save");
    const due = new Date(document.getElementById("stop-plan-date").value);
    button.disabled = true;
    planStatus.textContent = "Adding to the plan…";
    planStatus.classList.remove("error");
    try {
      const response = await fetch("/api/plan-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: stopStatus.current.placeId || stopStatus.current.id, due: due.toISOString() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to plan this stop");
      planStatus.textContent = "Added to the plan.";
      setTimeout(() => planForm.classList.add("hidden"), 900);
    } catch (error) {
      planStatus.textContent = error.message;
      planStatus.classList.add("error");
    } finally {
      button.disabled = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupAuthenticatedActions();
  loadStop();
});
