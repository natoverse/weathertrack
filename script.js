const map = L.map("map").setView([39.5, -98.35], 4);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const controls = {
  name: document.querySelector("#trip-name"),
  date: document.querySelector("#trip-date"),
  newTrip: document.querySelector("#new-trip"),
  undo: document.querySelector("#undo-point"),
  finish: document.querySelector("#finish-track"),
  addWaypoint: document.querySelector("#add-waypoint"),
  save: document.querySelector("#save-trip"),
  clear: document.querySelector("#clear-trip"),
  snap: document.querySelector("#snap-to-routes"),
  status: document.querySelector("#trip-status"),
  waypointList: document.querySelector("#waypoint-list"),
  updateForecast: document.querySelector("#update-forecast"),
  forecastStatus: document.querySelector("#forecast-status"),
  forecastResults: document.querySelector("#forecast-results"),
};

const track = L.polyline([], {
  color: "#1769aa",
  weight: 5,
  opacity: 0.9,
}).addTo(map);

const state = {
  anchors: [],
  segments: [],
  waypoints: [],
  recording: false,
  placingWaypoint: false,
  routing: false,
  routeRequest: 0,
  forecasting: false,
  forecastRequest: 0,
  forecastController: null,
  saving: false,
};

function localDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

controls.date.value = localDate();

function setStatus(message) {
  controls.status.value = message;
  controls.status.textContent = message;
}

function updateControls() {
  const hasTrack = state.anchors.length > 0;
  controls.undo.disabled = !state.recording || !hasTrack || state.routing;
  controls.finish.disabled =
    !state.recording || state.anchors.length < 2 || state.routing;
  controls.addWaypoint.disabled =
    state.recording || state.anchors.length < 2 || state.routing;
  controls.addWaypoint.textContent = state.placingWaypoint
    ? "Cancel stop"
    : "Add stop";
  controls.clear.disabled =
    !hasTrack && state.waypoints.length === 0 && !state.routing;
  controls.save.disabled =
    state.anchors.length < 2 || state.routing || state.saving;
  controls.newTrip.disabled = state.routing;
  controls.snap.disabled = state.routing;
  controls.updateForecast.disabled =
    state.waypoints.length === 0 ||
    !validDate(controls.date.value) ||
    state.routing ||
    state.forecasting;
}

function trackPoints() {
  if (state.anchors.length === 0) {
    return [];
  }

  return [
    state.anchors[0],
    ...state.segments.flatMap((segment) => segment.slice(1)),
  ];
}

function renderTrack() {
  track.setLatLngs(trackPoints());
}

function clearTrip() {
  state.routeRequest += 1;
  state.anchors = [];
  state.segments = [];
  state.recording = false;
  state.placingWaypoint = false;
  state.routing = false;
  state.waypoints.forEach(({ marker }) => marker.remove());
  state.waypoints = [];
  clearForecasts();
  controls.name.value = "";
  controls.date.value = localDate();
  controls.waypointList.replaceChildren();
  renderTrack();
  updateControls();
}

function decodePolyline(encoded) {
  const coordinates = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length && coordinates.length < 50000) {
    const deltas = [];

    for (let coordinate = 0; coordinate < 2; coordinate += 1) {
      let result = 0;
      let shift = 0;
      let byte;

      do {
        if (index >= encoded.length || shift > 30) {
          throw new Error("Invalid route geometry");
        }
        byte = encoded.charCodeAt(index) - 63;
        index += 1;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      deltas.push(result & 1 ? ~(result >> 1) : result >> 1);
    }

    latitude += deltas[0];
    longitude += deltas[1];
    coordinates.push(L.latLng(latitude / 1e6, longitude / 1e6));
  }

  if (coordinates.length < 2 || index < encoded.length) {
    throw new Error("Invalid route geometry");
  }

  return coordinates;
}

async function findRoute(start, end) {
  const requestUrl = new URL("https://valhalla1.openstreetmap.de/route");
  requestUrl.searchParams.set(
    "json",
    JSON.stringify({
      locations: [
        { lat: start.lat, lon: start.lng },
        { lat: end.lat, lon: end.lng },
      ],
      costing: "pedestrian",
      units: "kilometers",
    }),
  );

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(requestUrl, {
      signal: controller.signal,
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) {
      throw new Error("Routing service unavailable");
    }

    const result = await response.json();
    const shape = result?.trip?.legs?.[0]?.shape;
    if (typeof shape !== "string" || shape.length > 500000) {
      throw new Error("Routing service returned an invalid route");
    }

    return decodePolyline(shape);
  } finally {
    window.clearTimeout(timeout);
  }
}

async function addTrackPoint(point) {
  if (state.routing) {
    return;
  }

  if (state.anchors.length === 0) {
    state.anchors.push(point);
    renderTrack();
    setStatus("Start set. Click the map to continue the track.");
    updateControls();
    return;
  }

  const start = state.anchors[state.anchors.length - 1];
  const request = state.routeRequest + 1;
  state.routeRequest = request;
  state.routing = true;
  setStatus(
    controls.snap.checked
      ? "Finding a trail or road…"
      : "Adding a straight track segment…",
  );
  updateControls();

  let segment = [start, point];
  let snapped = false;

  if (controls.snap.checked) {
    try {
      segment = await findRoute(start, point);
      snapped = true;
    } catch {
      setStatus("No route found; added a straight segment instead.");
    }
  }

  if (request !== state.routeRequest) {
    return;
  }

  state.anchors.push(point);
  state.segments.push(segment);
  state.routing = false;
  renderTrack();
  setStatus(
    snapped
      ? "Route snapped. Click the map to continue, or finish the track."
      : "Point added. Click the map to continue, or finish the track.",
  );
  updateControls();
}

function closestPointOnTrack(point) {
  const points = trackPoints();
  const target = map.latLngToLayerPoint(point);
  let closest = points[0];
  let closestDistance = Infinity;

  for (let index = 1; index < points.length; index += 1) {
    const start = map.latLngToLayerPoint(points[index - 1]);
    const end = map.latLngToLayerPoint(points[index]);
    const delta = end.subtract(start);
    const lengthSquared = delta.x * delta.x + delta.y * delta.y;
    const ratio =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((target.x - start.x) * delta.x +
                (target.y - start.y) * delta.y) /
                lengthSquared,
            ),
          );
    const candidate = L.point(
      start.x + delta.x * ratio,
      start.y + delta.y * ratio,
    );
    const distance = target.distanceTo(candidate);

    if (distance < closestDistance) {
      closestDistance = distance;
      closest = map.layerPointToLatLng(candidate);
    }
  }

  return closest;
}

function renderWaypoint(location) {
  const stopNumber = state.waypoints.length + 1;
  const marker = L.marker(location)
    .bindTooltip(`Stop ${stopNumber}`, {
      permanent: true,
      direction: "top",
    })
    .addTo(map);
  const item = document.createElement("li");
  item.textContent = `Stop ${stopNumber}`;
  controls.waypointList.append(item);
  state.waypoints.push({ marker, item });
  clearForecasts();
}

function addWaypoint(point) {
  const stopNumber = state.waypoints.length + 1;
  renderWaypoint(closestPointOnTrack(point));
  state.placingWaypoint = false;
  setStatus(`Stop ${stopNumber} added. Add another stop or start a new trip.`);
  updateControls();
}

function coordinates(point) {
  return [
    Number(point.lat.toFixed(6)),
    Number(point.lng.toFixed(6)),
  ];
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function stopDate(index) {
  const date = new Date(`${controls.date.value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

function clearForecasts() {
  state.forecastRequest += 1;
  state.forecasting = false;
  state.forecastController?.abort();
  state.forecastController = null;
  controls.forecastResults.replaceChildren();
  const message =
    state.waypoints.length === 0
      ? "Add a stop to load its NWS forecast."
      : "Select Update to load the NWS forecast.";
  controls.forecastStatus.value = message;
  controls.forecastStatus.textContent = message;
}

function tripData() {
  const trip = {
    name: controls.name.value.trim(),
    track: trackPoints().map(coordinates),
    stops: state.waypoints.map(({ marker }) =>
      coordinates(marker.getLatLng()),
    ),
  };
  if (validDate(controls.date.value)) {
    trip.start = controls.date.value;
  }
  return trip;
}

function tripStorageUrl(token) {
  const configuredUrl = window.WEATHERTRACK_DATABASE_URL;
  if (typeof configuredUrl !== "string" || configuredUrl.length === 0) {
    throw new Error("Trip storage is not configured");
  }

  const url = new URL(configuredUrl);
  if (
    url.protocol !== "https:" ||
    (!url.hostname.endsWith(".firebaseio.com") &&
      !url.hostname.endsWith(".firebasedatabase.app"))
  ) {
    throw new Error("Trip storage URL is invalid");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/trips/${token}.json`;
  url.search = "";
  url.hash = "";
  return url;
}

function tripToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function saveTrip() {
  const token = tripToken();
  let storageUrl;
  try {
    storageUrl = tripStorageUrl(token);
  } catch {
    setStatus("Cloud trip storage is not configured.");
    return;
  }

  state.saving = true;
  setStatus("Saving trip…");
  updateControls();

  try {
    const response = await fetch(storageUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tripData()),
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) {
      throw new Error("Trip storage is unavailable");
    }

    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("trip", token);
    window.history.replaceState(null, "", url);
    setStatus("Trip saved. Copy this page’s URL to share it.");
  } catch {
    setStatus("The trip could not be saved. Please try again.");
  } finally {
    state.saving = false;
    updateControls();
  }
}

function loadSavedTrip(trip) {
  const stops = trip?.stops ?? [];
  if (
    typeof trip?.name !== "string" ||
    trip.name.length > 100 ||
    !Array.isArray(trip.track) ||
    trip.track.length < 2 ||
    trip.track.length > 50000 ||
    !trip.track.every(validCoordinates) ||
    !Array.isArray(stops) ||
    stops.length > 1000 ||
    !stops.every(validCoordinates) ||
    (trip.start !== undefined && !validDate(trip.start))
  ) {
    throw new Error("Invalid trip");
  }

  controls.name.value = trip.name;
  if (trip.start !== undefined) {
    controls.date.value = trip.start;
  }
  state.anchors = trip.track.map(([lat, lng]) => L.latLng(lat, lng));
  state.segments = state.anchors
    .slice(1)
    .map((point, index) => [state.anchors[index], point]);
  stops.forEach(([lat, lng]) => renderWaypoint(L.latLng(lat, lng)));
  renderTrack();
  setStatus("Shared trip loaded.");
  map.fitBounds(track.getBounds(), { padding: [30, 30] });
  updateControls();
}

function loadLegacyTrip(parameters) {
  const trip = {
    name: (parameters.get("name") || "").slice(0, 100),
    track: JSON.parse(parameters.get("track")),
    stops: JSON.parse(parameters.get("stops") || "[]"),
  };
  if (parameters.has("start")) {
    trip.start = parameters.get("start");
  }
  loadSavedTrip(trip);
}

async function loadTrip() {
  const parameters = new URLSearchParams(window.location.search);
  const token = parameters.get("trip");
  if (!token && !parameters.has("track")) {
    return;
  }

  try {
    if (!token) {
      loadLegacyTrip(parameters);
      return;
    }
    if (!/^[a-f0-9]{32}$/.test(token)) {
      throw new Error("Invalid trip");
    }

    setStatus("Loading shared trip…");
    const response = await fetch(tripStorageUrl(token), {
      headers: { Accept: "application/json" },
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) {
      throw new Error("Trip storage is unavailable");
    }
    loadSavedTrip(await response.json());
  } catch {
    setStatus("This shared trip URL could not be loaded.");
  }
}

function validCoordinates(value) {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(Number.isFinite) &&
    value[0] >= -90 &&
    value[0] <= 90 &&
    value[1] >= -180 &&
    value[1] <= 180
  );
}

async function fetchNws(url, signal) {
  const response = await fetch(url, {
    headers: { Accept: "application/geo+json" },
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!response.ok) {
    throw new Error("NWS data is unavailable");
  }
  return response.json();
}

function nwsUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "api.weather.gov") {
    throw new Error("NWS returned an invalid forecast address");
  }
  return url;
}

async function loadStopForecast(waypoint, index, signal) {
  const location = waypoint.marker.getLatLng();
  const pointUrl = new URL(
    `https://api.weather.gov/points/${location.lat.toFixed(4)},${location.lng.toFixed(4)}`,
  );
  const pointData = await fetchNws(pointUrl, signal);
  const forecastUrl = nwsUrl(pointData?.properties?.forecast);
  const forecast = await fetchNws(forecastUrl, signal);
  const date = stopDate(index);
  const periods = forecast?.properties?.periods;

  if (!Array.isArray(periods)) {
    throw new Error("NWS returned an invalid forecast");
  }

  return {
    date,
    place: [
      pointData?.properties?.relativeLocation?.properties?.city,
      pointData?.properties?.relativeLocation?.properties?.state,
    ]
      .filter((part) => typeof part === "string" && part)
      .join(", "),
    periods: periods.filter(
      (period) =>
        typeof period?.startTime === "string" &&
        period.startTime.slice(0, 10) === date,
    ),
  };
}

function addText(parent, elementName, text, className) {
  const element = document.createElement(elementName);
  element.textContent = String(text).slice(0, 2000);
  if (className) {
    element.className = className;
  }
  parent.append(element);
  return element;
}

function renderForecast(result, index) {
  const card = document.createElement("article");
  card.className = "forecast-card";
  addText(card, "h3", `Stop ${index + 1} — ${result.date}`);

  if (result.place) {
    addText(card, "p", result.place);
  }

  if (result.error) {
    addText(card, "p", result.error, "forecast-detail");
  } else if (result.periods.length === 0) {
    addText(
      card,
      "p",
      "No NWS forecast is available for this date.",
      "forecast-detail",
    );
  } else {
    const list = document.createElement("ul");
    result.periods.forEach((period) => {
      const item = document.createElement("li");
      const temperature =
        Number.isFinite(period.temperature) &&
        ["F", "C"].includes(period.temperatureUnit)
          ? `, ${period.temperature}°${period.temperatureUnit}`
          : "";
      addText(
        item,
        "strong",
        `${period.name || "Forecast"}${temperature}: ${period.shortForecast || ""}`,
      );
      if (period.detailedForecast) {
        addText(item, "div", period.detailedForecast, "forecast-detail");
      }
      list.append(item);
    });
    card.append(list);
  }

  controls.forecastResults.append(card);
}

async function updateForecasts() {
  const request = state.forecastRequest + 1;
  state.forecastRequest = request;
  state.forecasting = true;
  state.forecastController?.abort();
  const controller = new AbortController();
  state.forecastController = controller;
  controls.forecastResults.replaceChildren();
  controls.forecastStatus.value = "Loading NWS forecasts…";
  controls.forecastStatus.textContent = "Loading NWS forecasts…";
  updateControls();

  const timeout = window.setTimeout(() => controller.abort(), 15000);
  const results = await Promise.all(
    state.waypoints.map((waypoint, index) =>
      loadStopForecast(waypoint, index, controller.signal).catch((error) => ({
        date: stopDate(index),
        error:
          error.name === "AbortError"
            ? "The NWS request timed out."
            : "The NWS forecast could not be loaded for this stop.",
        periods: [],
      })),
    ),
  );
  window.clearTimeout(timeout);

  if (request !== state.forecastRequest) {
    return;
  }

  state.forecasting = false;
  state.forecastController = null;
  results.forEach(renderForecast);
  const updated = new Date();
  controls.forecastStatus.value = `Updated ${updated.toLocaleString()}.`;
  controls.forecastStatus.textContent = `Updated ${updated.toLocaleString()}.`;
  updateControls();
}

controls.newTrip.addEventListener("click", () => {
  clearTrip();
  state.recording = true;
  setStatus("Click the map to set the start of the track.");
  updateControls();
});

controls.undo.addEventListener("click", () => {
  state.anchors.pop();
  if (state.segments.length > 0) {
    state.segments.pop();
  }
  renderTrack();
  setStatus(
    state.anchors.length === 0
      ? "Start removed. Click the map to set a new start."
      : "Last point removed. Continue plotting the track.",
  );
  updateControls();
});

controls.finish.addEventListener("click", () => {
  state.recording = false;
  state.placingWaypoint = false;
  setStatus("Track finished. Select “Add stop,” then click along the track.");
  updateControls();
  map.fitBounds(track.getBounds(), { padding: [30, 30] });
});

controls.addWaypoint.addEventListener("click", () => {
  state.placingWaypoint = !state.placingWaypoint;
  setStatus(
    state.placingWaypoint
      ? "Click near the track to mark a stop."
      : "Stop placement canceled.",
  );
  updateControls();
});

controls.clear.addEventListener("click", () => {
  clearTrip();
  setStatus("Trip cleared. Select “New trip” to begin.");
});

controls.save.addEventListener("click", saveTrip);
controls.updateForecast.addEventListener("click", updateForecasts);
controls.date.addEventListener("change", () => {
  clearForecasts();
  updateControls();
});

map.on("click", ({ latlng }) => {
  if (state.recording) {
    addTrackPoint(latlng);
  } else if (state.placingWaypoint) {
    addWaypoint(latlng);
  }
});

loadTrip();
updateControls();
