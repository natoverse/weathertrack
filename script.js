const map = L.map("map").setView([39.5, -98.35], 4);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const controls = {
  newTrip: document.querySelector("#new-trip"),
  undo: document.querySelector("#undo-point"),
  finish: document.querySelector("#finish-track"),
  addWaypoint: document.querySelector("#add-waypoint"),
  clear: document.querySelector("#clear-trip"),
  snap: document.querySelector("#snap-to-routes"),
  status: document.querySelector("#trip-status"),
  waypointList: document.querySelector("#waypoint-list"),
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
};

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
  controls.newTrip.disabled = state.routing;
  controls.snap.disabled = state.routing;
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

function addWaypoint(point) {
  const stopNumber = state.waypoints.length + 1;
  const location = closestPointOnTrack(point);
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
  state.placingWaypoint = false;
  setStatus(`Stop ${stopNumber} added. Add another stop or start a new trip.`);
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

map.on("click", ({ latlng }) => {
  if (state.recording) {
    addTrackPoint(latlng);
  } else if (state.placingWaypoint) {
    addWaypoint(latlng);
  }
});

updateControls();
