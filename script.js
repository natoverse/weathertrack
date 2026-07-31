const map = L.map("map").setView([39.5, -98.35], 4);

const streetLayer = L.tileLayer(
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
).addTo(map);

const satelliteLayer = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  {
    maxZoom: 19,
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  },
);

const topographicLayer = L.tileLayer(
  "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 17,
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
  },
);

L.control
  .layers(
    {
      Street: streetLayer,
      Satellite: satelliteLayer,
      Topographic: topographicLayer,
    },
    null,
    { position: "topleft" },
  )
  .addTo(map);

const controls = {
  plannerTab: document.querySelector("#planner-tab"),
  tripsTab: document.querySelector("#trips-tab"),
  plannerPanel: document.querySelector("#planner-panel"),
  tripsPanel: document.querySelector("#trips-panel"),
  tripDetails: document.querySelector("#trip-details"),
  name: document.querySelector("#trip-name"),
  date: document.querySelector("#trip-date"),
  newTrip: document.querySelector("#new-trip"),
  undo: document.querySelector("#undo-point"),
  finish: document.querySelector("#finish-track"),
  addWaypoint: document.querySelector("#add-waypoint"),
  save: document.querySelector("#save-trip"),
  importGpx: document.querySelector("#import-gpx"),
  downloadGpx: document.querySelector("#download-gpx"),
  gpxFile: document.querySelector("#gpx-file"),
  clear: document.querySelector("#clear-trip"),
  snap: document.querySelector("#snap-to-routes"),
  status: document.querySelector("#trip-status"),
  waypointList: document.querySelector("#waypoint-list"),
  updateForecast: document.querySelector("#update-forecast"),
  forecastStatus: document.querySelector("#forecast-status"),
  forecastResults: document.querySelector("#forecast-results"),
  tripListStatus: document.querySelector("#trip-list-status"),
  tripList: document.querySelector("#trip-list"),
  tripProfile: document.querySelector("#trip-profile"),
  tripMileage: document.querySelector("#trip-mileage"),
  profileTotals: document.querySelector("#profile-totals"),
  elevationChart: document.querySelector("#elevation-chart"),
  profileStatus: document.querySelector("#profile-status"),
  daySummaryBody: document.querySelector("#day-summary-body"),
};

const track = L.polyline([], {
  color: "#075985",
  weight: 7,
  opacity: 1,
  className: "trip-track",
}).addTo(map);

const state = {
  anchors: [],
  segments: [],
  waypoints: [],
  tripStarted: false,
  recording: false,
  placingWaypoint: false,
  routing: false,
  routeRequest: 0,
  forecasting: false,
  forecastRequest: 0,
  forecastController: null,
  saving: false,
  importing: false,
  listingTrips: false,
  profileRequest: 0,
  profileController: null,
  elevationProfile: [],
  profileLoading: false,
};

const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;

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

function setTripListStatus(message) {
  controls.tripListStatus.value = message;
  controls.tripListStatus.textContent = message;
}

function selectTab(tab) {
  const showingPlanner = tab === "planner";
  controls.plannerTab.setAttribute("aria-selected", showingPlanner);
  controls.tripsTab.setAttribute("aria-selected", !showingPlanner);
  controls.plannerPanel.hidden = !showingPlanner;
  controls.tripsPanel.hidden = showingPlanner;
}

function updateControls() {
  const hasTrack = state.anchors.length > 0;
  controls.tripDetails.hidden = !state.tripStarted;
  map
    .getContainer()
    .classList.toggle(
      "map-editing",
      !state.importing && (state.recording || state.placingWaypoint),
    );
  controls.undo.disabled =
    !state.recording || !hasTrack || state.routing || state.importing;
  controls.finish.disabled =
    !state.recording ||
    state.anchors.length < 2 ||
    state.routing ||
    state.importing;
  controls.addWaypoint.disabled =
    state.recording ||
    state.anchors.length < 2 ||
    state.routing ||
    state.importing;
  controls.addWaypoint.textContent = state.placingWaypoint
    ? "Cancel stop"
    : "Add stop";
  controls.clear.disabled =
    (!hasTrack && state.waypoints.length === 0 && !state.routing) ||
    state.importing;
  controls.save.disabled =
    state.anchors.length < 2 ||
    state.routing ||
    state.saving ||
    state.importing;
  controls.importGpx.disabled =
    state.routing || state.saving || state.importing;
  controls.downloadGpx.disabled =
    state.anchors.length < 2 || state.routing || state.importing;
  controls.newTrip.disabled = state.routing || state.importing;
  controls.snap.disabled = state.routing || state.importing;
  controls.updateForecast.disabled =
    state.waypoints.length === 0 ||
    !validDate(controls.date.value) ||
    state.routing ||
    state.importing ||
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

function trackMeasurements(points = trackPoints()) {
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    distances.push(
      distances[index - 1] + map.distance(points[index - 1], points[index]),
    );
  }
  return { points, distances, total: distances.at(-1) || 0 };
}

function elevationAt(distance) {
  const profile = state.elevationProfile;
  if (profile.length === 0) {
    return null;
  }
  const nextIndex = profile.findIndex((point) => point.distance >= distance);
  if (nextIndex === -1) {
    return profile.at(-1).elevation;
  }
  if (nextIndex === 0) {
    return profile[0].elevation;
  }
  const start = profile[nextIndex - 1];
  const end = profile[nextIndex];
  const ratio = (distance - start.distance) / (end.distance - start.distance);
  return start.elevation + (end.elevation - start.elevation) * ratio;
}

function elevationMetrics(startDistance, endDistance) {
  if (state.elevationProfile.length === 0) {
    return null;
  }
  const elevations = [
    elevationAt(startDistance),
    ...state.elevationProfile
      .filter(
        ({ distance }) =>
          distance > startDistance && distance < endDistance,
      )
      .map(({ elevation }) => elevation),
    elevationAt(endDistance),
  ];
  let gain = 0;
  let descent = 0;
  for (let index = 1; index < elevations.length; index += 1) {
    const change = elevations[index] - elevations[index - 1];
    if (change > 0) {
      gain += change;
    } else {
      descent -= change;
    }
  }
  return { gain, descent };
}

function distanceAlongTrack(location, measurements) {
  const target = map.latLngToLayerPoint(location);
  let result = 0;
  let closestDistance = Infinity;

  for (let index = 1; index < measurements.points.length; index += 1) {
    const start = map.latLngToLayerPoint(measurements.points[index - 1]);
    const end = map.latLngToLayerPoint(measurements.points[index]);
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
    const candidateDistance = target.distanceTo(candidate);
    if (candidateDistance < closestDistance) {
      closestDistance = candidateDistance;
      result =
        measurements.distances[index - 1] +
        (measurements.distances[index] -
          measurements.distances[index - 1]) *
          ratio;
    }
  }
  return result;
}

function appendTableCell(row, text, header = false) {
  const cell = document.createElement(header ? "th" : "td");
  if (header) {
    cell.scope = "row";
  }
  cell.textContent = text;
  row.append(cell);
}

function renderElevationChart(measurements, stops) {
  controls.elevationChart.replaceChildren();
  if (state.elevationProfile.length === 0) {
    return;
  }

  const width = 600;
  const height = 180;
  const padding = 8;
  const elevations = state.elevationProfile.map(({ elevation }) => elevation);
  const minimum = Math.min(...elevations);
  const maximum = Math.max(...elevations);
  const range = Math.max(maximum - minimum, 1);
  const x = (distance) => (distance / measurements.total) * width;
  const y = (elevation) =>
    padding + ((maximum - elevation) / range) * (height - padding * 2);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `Elevation profile from ${Math.round(minimum * FEET_PER_METER)} to ${Math.round(maximum * FEET_PER_METER)} feet`,
  );
  const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const profilePath = state.elevationProfile
    .map(
      ({ distance, elevation }, index) =>
        `${index === 0 ? "M" : "L"} ${x(distance)} ${y(elevation)}`,
    )
    .join(" ");
  area.setAttribute(
    "d",
    `${profilePath} L ${width} ${height} L 0 ${height} Z`,
  );
  area.setAttribute("class", "profile-area");
  svg.append(area);

  stops.forEach(({ distance, number }) => {
    const elevation = elevationAt(distance);
    const marker = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    marker.setAttribute("cx", x(distance));
    marker.setAttribute("cy", y(elevation));
    marker.setAttribute("r", "6");
    const title = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "title",
    );
    title.textContent = `Stop ${number}: ${(distance / METERS_PER_MILE).toFixed(1)} miles, ${Math.round(elevation * FEET_PER_METER)} feet`;
    marker.append(title);
    svg.append(marker);
  });
  controls.elevationChart.append(svg);
}

function renderTripProfile() {
  const measurements = trackMeasurements();
  const hasTrack = measurements.points.length >= 2 && measurements.total > 0;
  controls.tripProfile.hidden = !hasTrack;
  if (!hasTrack) {
    return;
  }

  controls.tripMileage.textContent = `${(measurements.total / METERS_PER_MILE).toFixed(1)} miles`;
  const stops = state.waypoints
    .map(({ marker }, index) => ({
      distance: distanceAlongTrack(marker.getLatLng(), measurements),
      number: index + 1,
    }))
    .sort((first, second) => first.distance - second.distance);
  const metrics = elevationMetrics(0, measurements.total);
  controls.profileTotals.textContent = metrics
    ? `${Math.round(metrics.gain * FEET_PER_METER).toLocaleString()} ft gain · ${Math.round(metrics.descent * FEET_PER_METER).toLocaleString()} ft descent`
    : "";
  controls.profileStatus.textContent = state.profileLoading
    ? "Loading elevation…"
    : state.elevationProfile.length === 0
      ? "Elevation is unavailable."
      : "";
  renderElevationChart(measurements, stops);

  const boundaries = [
    0,
    ...stops.map(({ distance }) => distance),
    measurements.total,
  ].filter(
    (distance, index, values) =>
      index === 0 || distance - values[index - 1] > 1,
  );
  controls.daySummaryBody.replaceChildren();
  for (let index = 1; index < boundaries.length; index += 1) {
    const start = boundaries[index - 1];
    const end = boundaries[index];
    const dayMetrics = elevationMetrics(start, end);
    const row = document.createElement("tr");
    appendTableCell(row, `Day ${index}`, true);
    appendTableCell(row, ((end - start) / METERS_PER_MILE).toFixed(1));
    appendTableCell(
      row,
      dayMetrics
        ? `${Math.round(dayMetrics.gain * FEET_PER_METER).toLocaleString()} ft`
        : "—",
    );
    appendTableCell(
      row,
      dayMetrics
        ? `${Math.round(dayMetrics.descent * FEET_PER_METER).toLocaleString()} ft`
        : "—",
    );
    controls.daySummaryBody.append(row);
  }
}

function renderTrack() {
  track.setLatLngs(trackPoints());
  renderTripProfile();
}

function invalidateElevationProfile() {
  state.profileRequest += 1;
  state.profileController?.abort();
  state.profileController = null;
  state.elevationProfile = [];
  state.profileLoading = false;
}

function sampledTrack(measurements, maximumPoints = 200) {
  const sampleCount = Math.min(
    maximumPoints,
    Math.max(
      measurements.points.length,
      Math.ceil(measurements.total / 100) + 1,
    ),
  );
  if (sampleCount === measurements.points.length) {
    return measurements.points.map((location, index) => ({
      location,
      distance: measurements.distances[index],
    }));
  }

  const samples = [];
  let segmentIndex = 1;
  for (let index = 0; index < sampleCount; index += 1) {
    const distance = (measurements.total * index) / (sampleCount - 1);
    if (index === 0 || index === sampleCount - 1) {
      samples.push({
        distance,
        location:
          index === 0 ? measurements.points[0] : measurements.points.at(-1),
      });
      continue;
    }
    while (
      segmentIndex < measurements.distances.length - 1 &&
      measurements.distances[segmentIndex] <= distance
    ) {
      segmentIndex += 1;
    }
    const startDistance = measurements.distances[segmentIndex - 1];
    const endDistance = measurements.distances[segmentIndex];
    const ratio = (distance - startDistance) / (endDistance - startDistance);
    const start = measurements.points[segmentIndex - 1];
    const end = measurements.points[segmentIndex];
    samples.push({
      distance,
      location: L.latLng(
        start.lat + (end.lat - start.lat) * ratio,
        start.lng + (end.lng - start.lng) * ratio,
      ),
    });
  }
  return samples;
}

async function fetchElevations(samples, signal) {
  const response = await fetch("https://valhalla1.openstreetmap.de/height", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      shape: samples.map(({ location }) => ({
        lat: location.lat,
        lon: location.lng,
      })),
      range: true,
    }),
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!response.ok) {
    throw new Error("Elevation service unavailable");
  }
  const rangeHeight = (await response.json())?.range_height;
  if (
    !Array.isArray(rangeHeight) ||
    rangeHeight.length !== samples.length ||
    !rangeHeight.every(
      (value) =>
        Array.isArray(value) &&
        value.length >= 2 &&
        Number.isFinite(value[1]),
    )
  ) {
    throw new Error("Elevation service returned invalid data");
  }
  return rangeHeight.map((value, index) => ({
    distance: samples[index].distance,
    elevation: value[1],
  }));
}

async function loadElevationProfile() {
  const measurements = trackMeasurements();
  if (measurements.points.length < 2 || measurements.total === 0) {
    return;
  }
  const request = state.profileRequest + 1;
  state.profileRequest = request;
  state.profileController?.abort();
  const controller = new AbortController();
  state.profileController = controller;
  state.profileLoading = true;
  state.elevationProfile = [];
  renderTripProfile();
  const timeout = window.setTimeout(() => controller.abort(), 12000);

  try {
    const profile = await fetchElevations(
      sampledTrack(measurements),
      controller.signal,
    );
    if (request === state.profileRequest) {
      state.elevationProfile = profile;
    }
  } catch {
    if (request === state.profileRequest) {
      state.elevationProfile = [];
    }
  } finally {
    window.clearTimeout(timeout);
    if (request === state.profileRequest) {
      state.profileLoading = false;
      state.profileController = null;
      renderTripProfile();
    }
  }
}

function clearTrip() {
  state.routeRequest += 1;
  invalidateElevationProfile();
  state.anchors = [];
  state.segments = [];
  state.recording = false;
  state.placingWaypoint = false;
  state.routing = false;
  state.waypoints.forEach(({ marker }) => marker.remove());
  state.waypoints = [];
  state.tripStarted = false;
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
      units: "miles",
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
    invalidateElevationProfile();
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

  invalidateElevationProfile();
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
  renderTripProfile();
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

function childElements(parent, name) {
  return Array.from(parent.children).filter(
    (element) => element.localName === name,
  );
}

function parseGpx(document) {
  const root = document.documentElement;
  if (root.localName !== "gpx" || document.querySelector("parsererror")) {
    throw new Error("Invalid GPX");
  }

  const tracks = childElements(root, "trk");
  const points = tracks.flatMap((gpxTrack) =>
    childElements(gpxTrack, "trkseg").flatMap((segment) =>
      childElements(segment, "trkpt").map((point) => {
        const latitude = point.getAttribute("lat");
        const longitude = point.getAttribute("lon");
        return [
          latitude === null || latitude.trim() === "" ? NaN : Number(latitude),
          longitude === null || longitude.trim() === ""
            ? NaN
            : Number(longitude),
        ];
      }),
    ),
  );
  if (
    points.length < 2 ||
    points.length > 50000 ||
    !points.every(validCoordinates)
  ) {
    throw new Error("Invalid GPX track");
  }

  const nameElement = tracks
    .flatMap((gpxTrack) => childElements(gpxTrack, "name"))
    .find((element) => element.textContent.trim());
  return {
    name: (nameElement?.textContent.trim() || "").slice(0, 100),
    track: points,
    stops: [],
  };
}

function readGpx(file) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const finish = (document) => {
      URL.revokeObjectURL(url);
      if (document) {
        resolve(document);
      } else {
        reject(new Error("Invalid GPX"));
      }
    };
    request.addEventListener("load", () => finish(request.responseXML));
    request.addEventListener("error", () => finish());
    request.open("GET", url);
    request.responseType = "document";
    request.overrideMimeType("application/xml");
    request.send();
  });
}

async function importGpx() {
  const [file] = controls.gpxFile.files;
  if (!file) {
    return;
  }

  state.importing = true;
  setStatus("Importing GPX track…");
  updateControls();
  try {
    const trip = parseGpx(await readGpx(file));
    clearTrip();
    loadSavedTrip(trip);
    setStatus("GPX track imported.");
  } catch {
    setStatus("This GPX file does not contain a valid track.");
  } finally {
    state.importing = false;
    controls.gpxFile.value = "";
    updateControls();
  }
}

function escapeXml(value) {
  return value
    .replace(
      /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu,
      "",
    )
    .replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[character],
    );
}

function gpxData() {
  const name = controls.name.value.trim();
  const metadata = [
    name ? `<name>${escapeXml(name)}</name>` : "",
    validDate(controls.date.value)
      ? `<time>${controls.date.value}T00:00:00Z</time>`
      : "",
  ].join("");
  const points = trackPoints()
    .map(({ lat, lng }) => `<trkpt lat="${lat}" lon="${lng}"></trkpt>`)
    .join("");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="WeatherTrack" xmlns="http://www.topografix.com/GPX/1/1">',
    metadata ? `<metadata>${metadata}</metadata>` : "",
    `<trk>${name ? `<name>${escapeXml(name)}</name>` : ""}<trkseg>${points}</trkseg></trk>`,
    "</gpx>",
  ].join("");
}

function downloadGpx() {
  const filename =
    controls.name.value
      .trim()
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "weathertrack-trip";
  const url = URL.createObjectURL(
    new Blob([gpxData()], { type: "application/gpx+xml" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.gpx`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url));
  setStatus("GPX track downloaded.");
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
  const tripPath = `/trips${token ? `/${token}` : ""}.json`;
  url.pathname = `${url.pathname.replace(/\/$/, "")}${tripPath}`;
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
    loadTripList();
  } catch {
    setStatus("The trip could not be saved. Please try again.");
  } finally {
    state.saving = false;
    updateControls();
  }
}

function validTripSummary(trip) {
  return (
    typeof trip?.name === "string" &&
    trip.name.length <= 100 &&
    (trip.start === undefined || validDate(trip.start))
  );
}

function loadListedTrip(token, trip) {
  clearTrip();
  loadSavedTrip(trip);
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("trip", token);
  window.history.replaceState(null, "", url);
  selectTab("planner");
}

async function deleteListedTrip(token, name) {
  if (!window.confirm(`Delete “${name || "Untitled trip"}”?`)) {
    return;
  }

  try {
    const response = await fetch(tripStorageUrl(token), {
      method: "DELETE",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) {
      throw new Error("Trip storage is unavailable");
    }
    setTripListStatus("Trip deleted.");
    loadTripList();
  } catch {
    setTripListStatus("The trip could not be deleted. Please try again.");
  }
}

function renderTripList(trips) {
  controls.tripList.replaceChildren();
  trips.forEach(([token, trip]) => {
    const item = document.createElement("li");
    item.className = "saved-trip";
    const details = document.createElement("span");
    const name = document.createElement("strong");
    name.className = "saved-trip-name";
    name.textContent = trip.name || "Untitled trip";
    details.append(name);
    if (trip.start) {
      const date = document.createElement("span");
      date.className = "saved-trip-date";
      date.textContent = trip.start;
      details.append(date);
    }
    const load = document.createElement("button");
    load.type = "button";
    load.textContent = "Load";
    load.addEventListener("click", () => loadListedTrip(token, trip));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "saved-trip-delete";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteListedTrip(token, trip.name));
    item.append(details, load, remove);
    controls.tripList.append(item);
  });
}

async function loadTripList() {
  if (state.listingTrips) {
    return;
  }

  state.listingTrips = true;
  setTripListStatus("Loading trips…");
  try {
    const response = await fetch(tripStorageUrl(), {
      headers: { Accept: "application/json" },
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) {
      throw new Error("Trip storage is unavailable");
    }
    const trips = Object.entries((await response.json()) || {})
      .filter(
        ([token, trip]) =>
          /^[a-f0-9]{32}$/.test(token) && validTripSummary(trip),
      )
      .sort(([, first], [, second]) =>
        (first.start || "").localeCompare(second.start || ""),
      );
    renderTripList(trips);
    setTripListStatus(
      trips.length === 0
        ? "No saved trips yet."
        : `${trips.length} saved trip${trips.length === 1 ? "" : "s"}.`,
    );
  } catch {
    controls.tripList.replaceChildren();
    setTripListStatus("Trips could not be loaded. Please try again.");
  } finally {
    state.listingTrips = false;
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

  invalidateElevationProfile();
  state.tripStarted = true;
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
  loadElevationProfile();
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

function nwsPageUrl(location) {
  const url = new URL("https://forecast.weather.gov/MapClick.php");
  url.searchParams.set("lon", location.lng);
  url.searchParams.set("lat", location.lat);
  return url.href;
}

async function loadStopForecast(waypoint, index, signal) {
  const location = waypoint.marker.getLatLng();
  const pointUrl = new URL(
    `https://api.weather.gov/points/${location.lat.toFixed(4)},${location.lng.toFixed(4)}`,
  );
  const pointData = await fetchNws(pointUrl, signal);
  const forecastUrl = nwsUrl(pointData?.properties?.forecast);
  forecastUrl.searchParams.set("units", "us");
  const forecast = await fetchNws(forecastUrl, signal);
  const date = stopDate(index);
  const periods = forecast?.properties?.periods;

  if (!Array.isArray(periods)) {
    throw new Error("NWS returned an invalid forecast");
  }

  return {
    date,
    pageUrl: nwsPageUrl(location),
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

  const pageLink = addText(
    card,
    "a",
    "View forecast on weather.gov",
    "forecast-detail",
  );
  pageLink.href = result.pageUrl;

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
        pageUrl: nwsPageUrl(waypoint.marker.getLatLng()),
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
  state.tripStarted = true;
  state.recording = true;
  setStatus("Click the map to set the start of the track.");
  updateControls();
});

controls.plannerTab.addEventListener("click", () => selectTab("planner"));
controls.tripsTab.addEventListener("click", () => {
  selectTab("trips");
  loadTripList();
});
controls.undo.addEventListener("click", () => {
  invalidateElevationProfile();
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
  loadElevationProfile();
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
controls.importGpx.addEventListener("click", () => controls.gpxFile.click());
controls.gpxFile.addEventListener("change", importGpx);
controls.downloadGpx.addEventListener("click", downloadGpx);
controls.updateForecast.addEventListener("click", updateForecasts);
controls.date.addEventListener("change", () => {
  clearForecasts();
  updateControls();
});

map.on("click", ({ latlng }) => {
  if (state.importing) {
    return;
  }
  if (state.recording) {
    addTrackPoint(latlng);
  } else if (state.placingWaypoint) {
    addWaypoint(latlng);
  }
});

const tripParameters = new URLSearchParams(window.location.search);
if (!tripParameters.has("trip") && !tripParameters.has("track")) {
  map.locate({ setView: true, maxZoom: 13 });
}

loadTrip();
loadTripList();
updateControls();
