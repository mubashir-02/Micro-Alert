// ─── Micro-Alert Map Controller ─────────────────────────────────────────────────
// Handles Leaflet map, markers, heatmap, routing, and emergency services

// ─── Constants ──────────────────────────────────────────────────────────────────
const CHENNAI_CENTER = [13.0827, 80.2707];
const DEFAULT_ZOOM = 12;

// Chennai landmark coordinates for routing
const LANDMARKS = {
  'anna nagar': [13.0850, 80.2101],
  't. nagar': [13.0418, 80.2341],
  't nagar': [13.0418, 80.2341],
  'tambaram': [12.9249, 80.1445],
  'adyar': [13.0063, 80.2574],
  'chennai central': [13.0827, 80.2707],
  'central': [13.0827, 80.2707],
  'marina beach': [13.0500, 80.2824],
  'marina': [13.0500, 80.2824],
  'vadapalani': [13.0604, 80.2185],
  'koyambedu': [13.0743, 80.2089],
  'guindy': [13.0067, 80.2206],
  'sholinganallur': [12.9012, 80.2279],
  'velachery': [12.9485, 80.2204],
  'egmore': [13.0734, 80.2428],
  'kathipara': [13.0123, 80.2121],
  'spencer plaza': [13.0654, 80.2628],
  'mylapore': [13.0368, 80.2676],
  'thiruvanmiyur': [12.9835, 80.2641],
  'porur': [13.0371, 80.1527],
  'ashok nagar': [13.0376, 80.2093],
  'nungambakkam': [13.0601, 80.2489],
  'gemini': [13.0628, 80.2552],
  'teynampet': [13.0475, 80.2396],
  'muttukadu': [12.8256, 80.2463],
  'ecr': [12.8700, 80.2470],
  'omr': [12.9500, 80.2400],
  'mount road': [13.0627, 80.2707],
  'flower bazaar': [13.0868, 80.2573],
  'anna salai': [13.0628, 80.2552],
  'alwarpet': [13.0336, 80.2497],
  'chromepet': [12.9516, 80.1462],
  'pallavaram': [12.9675, 80.1491],
  'perambur': [13.1100, 80.2400],
  'royapettah': [13.0530, 80.2620],
  'kilpauk': [13.0840, 80.2420]
};

// ─── State ──────────────────────────────────────────────────────────────────────
let map;
let allRisks = [];
let riskMarkers = [];
let heatLayer = null;
let heatmapVisible = false;
let routeLayer = null;
let routeDestinationMarkers = [];
let pickingLocation = false;
let pickedLatLng = null;
let emergencyMarkers = [];

// ─── Map Initialization ────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: CHENNAI_CENTER,
    zoom: DEFAULT_ZOOM,
    zoomControl: false,
    attributionControl: true
  });

  // Dark tile layer
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  // Add zoom control to right side
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Map click handler for location picking
  map.on('click', onMapClick);

  // Load risks
  loadAllRisks();
}

// ─── Load All Risks ─────────────────────────────────────────────────────────────
async function loadAllRisks() {
  try {
    const res = await fetch('/api/risks');
    const json = await res.json();
    if (json.success) {
      allRisks = json.data;
      renderMarkers();
      renderRiskList();
      initHeatLayer();
    }
  } catch (err) {
    console.error('Failed to load risks:', err);
  }
}

// ─── Render Risk Markers ────────────────────────────────────────────────────────
function renderMarkers() {
  // Clear existing markers
  riskMarkers.forEach(m => map.removeLayer(m));
  riskMarkers = [];

  allRisks.forEach(risk => {
    const [lng, lat] = risk.location.coordinates;
    const marker = L.marker([lat, lng], {
      icon: createRiskIcon(risk)
    });

    marker.bindPopup(createPopupHTML(risk), {
      maxWidth: 300,
      className: 'risk-popup'
    });

    marker.addTo(map);
    riskMarkers.push(marker);
  });
}

// ─── Create Custom Icon ─────────────────────────────────────────────────────────
function createRiskIcon(risk) {
  return L.divIcon({
    html: `<div class="custom-marker ${risk.type}">${risk.severity}</div>`,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16]
  });
}

// ─── Create Popup HTML ──────────────────────────────────────────────────────────
function createPopupHTML(risk) {
  const typeLabels = {
    sudden_brake: 'Sudden Braking',
    blind_turn: 'Blind Turn',
    habitual_violation: 'Habitual Violation',
    accident: '💥 Accident Zone'
  };

  const timeLabels = {
    morning_rush: '🌅 Morning Rush',
    afternoon: '☀️ Afternoon',
    evening_rush: '🌆 Evening Rush',
    night: '🌙 Night'
  };

  const weatherIcons = {
    clear: '☀️',
    rain: '🌧️',
    fog: '🌫️'
  };

  let severityDots = '';
  for (let i = 1; i <= 5; i++) {
    const activeClass = i <= risk.severity ? `active s${risk.severity}` : '';
    severityDots += `<div class="severity-dot ${activeClass}"></div>`;
  }

  const riskId = risk._id;

  return `
    <div class="popup-inner">
      <span class="popup-type ${risk.type}">${typeLabels[risk.type]}</span>
      <h3>${risk.roadName}</h3>
      ${risk.landmark ? `<p style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">📍 ${risk.landmark}</p>` : ''}
      <p class="popup-desc">${risk.description}</p>
      <div class="popup-meta">
        <span>${timeLabels[risk.timeOfDay]}</span>
        <span>${weatherIcons[risk.weather]} ${risk.weather}</span>
        <span>${risk.verified ? '✅ Verified' : '⏳ Unverified'}</span>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">Severity</div>
      <div class="severity-bar">${severityDots}</div>
      <button class="popup-explain-btn" onclick="explainRisk('${riskId}')">
        🧠 Explain This Risk
      </button>
      <div id="explain-${riskId}" class="popup-explain-result" style="display:none;"></div>
    </div>
  `;
}

// ─── Heatmap ────────────────────────────────────────────────────────────────────
function initHeatLayer() {
  const heatData = allRisks.map(r => {
    const [lng, lat] = r.location.coordinates;
    return [lat, lng, r.severity * 0.2];
  });

  heatLayer = L.heatLayer(heatData, {
    radius: 30,
    blur: 20,
    maxZoom: 15,
    max: 1.0,
    gradient: {
      0.2: '#3b82f6',
      0.4: '#06b6d4',
      0.6: '#eab308',
      0.8: '#f97316',
      1.0: '#ef4444'
    }
  });
}

function toggleHeatmap() {
  const btn = document.getElementById('heatmapToggle');
  if (heatmapVisible) {
    map.removeLayer(heatLayer);
    btn.classList.remove('active');
    // Show markers
    riskMarkers.forEach(m => m.addTo(map));
  } else {
    heatLayer.addTo(map);
    btn.classList.add('active');
    // Optionally hide markers for cleaner heat view
    riskMarkers.forEach(m => map.removeLayer(m));
  }
  heatmapVisible = !heatmapVisible;
}

// ─── Route Scanning ─────────────────────────────────────────────────────────────
function fillRoute(start, end) {
  document.getElementById('startLocation').value = start;
  document.getElementById('endLocation').value = end;
  // Close any open dropdowns
  document.getElementById('startDropdown').innerHTML = '';
  document.getElementById('startDropdown').style.display = 'none';
  document.getElementById('endDropdown').innerHTML = '';
  document.getElementById('endDropdown').style.display = 'none';
}

// Resolve a location name to [lat, lng] — tries local landmarks first, then Nominatim geocoding
async function resolveLocation(name) {
  const key = name.toLowerCase().trim();

  // Try local landmarks first for instant results
  if (LANDMARKS[key]) return LANDMARKS[key];
  for (const [k, v] of Object.entries(LANDMARKS)) {
    if (k.includes(key) || key.includes(k)) return v;
  }

  // Fall back to Nominatim geocoding for any location worldwide
  return await geocodeLocation(name);
}

async function geocodeLocation(query) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    if (data && data.length > 0) {
      return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
    }
  } catch (e) {
    console.warn('Geocoding failed:', e);
  }
  return null;
}

// ─── Autocomplete ───────────────────────────────────────────────────────────────
let autocompleteTimers = {};

function setupAutocomplete(inputId, dropdownId) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);

  input.addEventListener('input', () => {
    const query = input.value.trim();

    // Clear previous timer
    if (autocompleteTimers[inputId]) clearTimeout(autocompleteTimers[inputId]);

    if (query.length < 3) {
      dropdown.innerHTML = '';
      dropdown.style.display = 'none';
      return;
    }

    // Debounce: wait 350ms after user stops typing
    autocompleteTimers[inputId] = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const results = await res.json();

        if (results && results.length > 0) {
          dropdown.innerHTML = results.map(r => {
            const displayName = r.display_name.length > 60
              ? r.display_name.substring(0, 60) + '…'
              : r.display_name;
            return `<div class="autocomplete-item" data-lat="${r.lat}" data-lon="${r.lon}" data-name="${r.display_name.split(',').slice(0, 3).join(',')}">
              <span class="ac-icon">📍</span>
              <span class="ac-text">${displayName}</span>
            </div>`;
          }).join('');
          dropdown.style.display = 'block';

          // Add click handlers
          dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
              input.value = item.dataset.name;
              input.dataset.lat = item.dataset.lat;
              input.dataset.lon = item.dataset.lon;
              dropdown.innerHTML = '';
              dropdown.style.display = 'none';
            });
          });
        } else {
          dropdown.innerHTML = '<div class="autocomplete-item no-results"><span class="ac-text">No results found</span></div>';
          dropdown.style.display = 'block';
        }
      } catch (e) {
        console.warn('Autocomplete fetch failed:', e);
        dropdown.style.display = 'none';
      }
    }, 350);
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}

// Initialize autocomplete on both inputs after DOM loads
document.addEventListener('DOMContentLoaded', () => {
  setupAutocomplete('startLocation', 'startDropdown');
  setupAutocomplete('endLocation', 'endDropdown');
});

async function scanRoute() {
  const startInput = document.getElementById('startLocation');
  const endInput = document.getElementById('endLocation');
  const startName = startInput.value.trim();
  const endName = endInput.value.trim();

  if (!startName || !endName) {
    showToast('Please enter both start and end locations', 'error');
    return;
  }

  // Show loading
  document.getElementById('routeLoading').classList.add('visible');
  document.getElementById('routeAlert').classList.remove('visible');
  document.getElementById('scanRouteBtn').disabled = true;

  // Check if coords were cached from autocomplete selection
  let startCoords = null;
  let endCoords = null;

  if (startInput.dataset.lat && startInput.dataset.lon) {
    startCoords = [parseFloat(startInput.dataset.lat), parseFloat(startInput.dataset.lon)];
  } else {
    startCoords = await resolveLocation(startName);
  }

  if (endInput.dataset.lat && endInput.dataset.lon) {
    endCoords = [parseFloat(endInput.dataset.lat), parseFloat(endInput.dataset.lon)];
  } else {
    endCoords = await resolveLocation(endName);
  }

  if (!startCoords || !endCoords) {
    showToast('Could not find one or both locations. Please try different search terms.', 'error');
    document.getElementById('routeLoading').classList.remove('visible');
    document.getElementById('scanRouteBtn').disabled = false;
    return;
  }

  // Clear previous route and destination markers
  if (routeLayer) map.removeLayer(routeLayer);
  clearRouteDestinationMarkers();

  try {
    // Try OSRM for a realistic route
    const routeCoords = await fetchOSRMRoute(startCoords, endCoords);

    routeLayer = L.polyline(routeCoords, {
      color: '#3b82f6',
      weight: 4,
      opacity: 0.8,
      dashArray: '8, 8',
      lineCap: 'round'
    }).addTo(map);

    // Add destination markers (Start & End)
    const startMarker = L.marker(startCoords, {
      icon: L.divIcon({
        html: `<div class="destination-marker start-marker">
                 <div class="dest-marker-pin">
                   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                     <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
                   </svg>
                 </div>
                 <div class="dest-marker-label">START</div>
                 <div class="dest-marker-pulse"></div>
               </div>`,
        className: '',
        iconSize: [40, 56],
        iconAnchor: [20, 52],
        popupAnchor: [0, -52]
      }),
      zIndexOffset: 900
    }).addTo(map);
    startMarker.bindPopup(`<div class="popup-inner"><span class="popup-type" style="background:rgba(16,185,129,0.15);color:#10b981;">START POINT</span><h3>${startName}</h3><p class="popup-desc">Route departure location</p></div>`);
    routeDestinationMarkers.push(startMarker);

    const endMarker = L.marker(endCoords, {
      icon: L.divIcon({
        html: `<div class="destination-marker end-marker">
                 <div class="dest-marker-pin">
                   <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                     <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
                   </svg>
                 </div>
                 <div class="dest-marker-label">END</div>
                 <div class="dest-marker-pulse"></div>
               </div>`,
        className: '',
        iconSize: [40, 56],
        iconAnchor: [20, 52],
        popupAnchor: [0, -52]
      }),
      zIndexOffset: 900
    }).addTo(map);
    endMarker.bindPopup(`<div class="popup-inner"><span class="popup-type" style="background:rgba(239,68,68,0.15);color:#ef4444;">DESTINATION</span><h3>${endName}</h3><p class="popup-desc">Route arrival location</p></div>`);
    routeDestinationMarkers.push(endMarker);

    map.fitBounds(routeLayer.getBounds(), { padding: [60, 60] });

    // Fetch risks along route
    const res = await fetch(`/api/risks/along-route?startLat=${startCoords[0]}&startLng=${startCoords[1]}&endLat=${endCoords[0]}&endLng=${endCoords[1]}`);
    const json = await res.json();

    if (json.success && json.data.length > 0) {
      // Call condensed alert API
      await getCondensedAlert(json.data);
    } else {
      const alertBox = document.getElementById('routeAlert');
      alertBox.classList.add('visible');
      document.getElementById('routeAlertText').textContent = '✅ No significant risks detected along this route. Drive safely!';
    }
  } catch (err) {
    console.error('Route scan error:', err);
    showToast('Error scanning route. Please try again.', 'error');
  } finally {
    document.getElementById('routeLoading').classList.remove('visible');
    document.getElementById('scanRouteBtn').disabled = false;
  }
}

async function fetchOSRMRoute(start, end) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.routes && data.routes.length > 0) {
      return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
    }
  } catch (e) {
    console.warn('OSRM routing failed, using straight line:', e);
  }

  // Fallback: create a simple polyline with intermediate points
  const points = [];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lat = start[0] + t * (end[0] - start[0]);
    const lng = start[1] + t * (end[1] - start[1]);
    // Add slight randomness for visual interest
    const jitter = Math.sin(t * Math.PI * 3) * 0.003;
    points.push([lat + jitter, lng + jitter * 0.5]);
  }
  return points;
}

// ─── Clear Route Destination Markers ────────────────────────────────────────────
function clearRouteDestinationMarkers() {
  routeDestinationMarkers.forEach(m => map.removeLayer(m));
  routeDestinationMarkers = [];
}

// ─── Map Click Handler ──────────────────────────────────────────────────────────
function onMapClick(e) {
  // For location picking in report form
  pickedLatLng = e.latlng;
  document.getElementById('pickedLat').textContent = e.latlng.lat.toFixed(6);
  document.getElementById('pickedLng').textContent = e.latlng.lng.toFixed(6);
  document.getElementById('pickedCoords').style.display = 'block';
  document.getElementById('locationPickerHint').style.display = 'none';
}

// ─── Emergency Services ─────────────────────────────────────────────────────────
async function showEmergency() {
  const overlay = document.getElementById('emergencyOverlay');
  const btn = document.getElementById('emergencyBtn');

  if (overlay.classList.contains('visible')) {
    closeEmergency();
    return;
  }

  const center = map.getCenter();
  try {
    const res = await fetch(`/api/emergency?lat=${center.lat}&lng=${center.lng}`);
    const json = await res.json();

    if (json.success) {
      const list = document.getElementById('emergencyList');
      list.innerHTML = json.data.map(s => `
        <div class="emergency-item" onclick="flyToEmergency(${s.lat}, ${s.lng})">
          <span class="em-icon">${s.icon}</span>
          <div class="em-info">
            <h4>${s.name}</h4>
            <p>${s.address}</p>
            <span class="em-phone">📞 ${s.phone}</span>
          </div>
          ${s.distance !== undefined ? `<span class="em-distance">${s.distance.toFixed(1)} km</span>` : ''}
        </div>
      `).join('');

      overlay.classList.add('visible');
      btn.classList.add('active');

      // Add markers for emergency services
      clearEmergencyMarkers();
      json.data.forEach(s => {
        const marker = L.marker([s.lat, s.lng], {
          icon: L.divIcon({
            html: `<div style="font-size:24px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));">${s.icon}</div>`,
            className: '',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
          })
        }).addTo(map);
        marker.bindPopup(`<div class="popup-inner"><h3>${s.name}</h3><p class="popup-desc">${s.address}<br>📞 ${s.phone}</p></div>`);
        emergencyMarkers.push(marker);
      });
    }
  } catch (err) {
    showToast('Could not load emergency services', 'error');
  }
}

function closeEmergency() {
  document.getElementById('emergencyOverlay').classList.remove('visible');
  document.getElementById('emergencyBtn').classList.remove('active');
  clearEmergencyMarkers();
}

function clearEmergencyMarkers() {
  emergencyMarkers.forEach(m => map.removeLayer(m));
  emergencyMarkers = [];
}

function flyToEmergency(lat, lng) {
  map.flyTo([lat, lng], 15, { duration: 1 });
}

// ─── Risk List ──────────────────────────────────────────────────────────────────
function renderRiskList() {
  const top5 = allRisks
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 5);

  document.getElementById('riskCount').textContent = allRisks.length;

  const typeLabels = {
    sudden_brake: 'Sudden Brake',
    blind_turn: 'Blind Turn',
    habitual_violation: 'Violation',
    accident: 'Accident'
  };

  const list = document.getElementById('riskList');
  list.innerHTML = top5.map(r => {
    const [lng, lat] = r.location.coordinates;
    return `
      <div class="risk-item" onclick="flyToRisk(${lat}, ${lng})">
        <div class="risk-severity s${r.severity}">${r.severity}</div>
        <div class="risk-info">
          <h4>${r.roadName}</h4>
          <p>${r.description}</p>
          <div class="risk-meta">
            <span class="risk-tag ${r.type}">${typeLabels[r.type]}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function flyToRisk(lat, lng) {
  map.flyTo([lat, lng], 16, { duration: 1 });
  // Close sidebar on mobile
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('open');
  }
}

// ─── Center Map ─────────────────────────────────────────────────────────────────
function centerMap() {
  map.flyTo(CHENNAI_CENTER, DEFAULT_ZOOM, { duration: 1 });
}

// ─── My Location (Geolocation) ──────────────────────────────────────────────────
let userLocationMarker = null;
let userAccuracyCircle = null;

function locateMe() {
  const btn = document.getElementById('locateBtn');

  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser', 'error');
    return;
  }

  // Show loading state
  btn.classList.add('locating');
  showToast('Detecting your location…', 'success');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;

      // Remove old markers
      if (userLocationMarker) map.removeLayer(userLocationMarker);
      if (userAccuracyCircle) map.removeLayer(userAccuracyCircle);

      // Add accuracy circle
      userAccuracyCircle = L.circle([latitude, longitude], {
        radius: accuracy,
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.08,
        weight: 1,
        opacity: 0.3
      }).addTo(map);

      // Add pulsing blue dot marker
      userLocationMarker = L.marker([latitude, longitude], {
        icon: L.divIcon({
          html: `<div class="my-location-dot">
                   <div class="my-location-pulse"></div>
                   <div class="my-location-core"></div>
                 </div>`,
          className: '',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        }),
        zIndexOffset: 1000
      }).addTo(map);

      userLocationMarker.bindPopup(
        `<div class="popup-inner">
           <h3>📍 You are here</h3>
           <p class="popup-desc" style="margin-bottom:4px;">Lat: ${latitude.toFixed(6)}, Lng: ${longitude.toFixed(6)}</p>
           <p class="popup-desc">Accuracy: ~${Math.round(accuracy)}m</p>
         </div>`
      );

      // Fly to location
      const zoomLevel = accuracy < 100 ? 17 : accuracy < 500 ? 15 : 14;
      map.flyTo([latitude, longitude], zoomLevel, { duration: 1.5 });

      // Auto-fill the start location input with coordinates
      const startInput = document.getElementById('startLocation');
      if (startInput && !startInput.value) {
        startInput.value = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      }

      // Try to reverse-geocode for a friendly name
      reverseGeocode(latitude, longitude).then(name => {
        if (name && startInput) {
          startInput.value = name;
          showToast(`📍 Located: ${name}`, 'success');
        } else {
          showToast('📍 Location found!', 'success');
        }
      });

      btn.classList.remove('locating');
      btn.classList.add('active');
    },
    (error) => {
      btn.classList.remove('locating');
      let msg = 'Could not detect your location.';
      switch (error.code) {
        case error.PERMISSION_DENIED:
          msg = 'Location permission denied. Please allow location access.';
          break;
        case error.POSITION_UNAVAILABLE:
          msg = 'Location information is unavailable.';
          break;
        case error.TIMEOUT:
          msg = 'Location request timed out. Try again.';
          break;
      }
      showToast(msg, 'error');
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000
    }
  );
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    if (data && data.address) {
      const a = data.address;
      const parts = [
        a.road || a.neighbourhood || a.hamlet || '',
        a.suburb || a.city_district || a.town || a.city || ''
      ].filter(Boolean);
      return parts.join(', ') || data.display_name?.split(',').slice(0, 2).join(',') || null;
    }
  } catch (e) {
    console.warn('Reverse geocoding failed:', e);
  }
  return null;
}

// ─── Panel Toggle ───────────────────────────────────────────────────────────────
function togglePanel(panelId) {
  const panel = document.getElementById(panelId);
  panel.classList.toggle('collapsed');
}

// ─── Sidebar Toggle (Mobile) ────────────────────────────────────────────────────
document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// ─── Toast Notifications ────────────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${type === 'success' ? '✅' : '❌'} ${message}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(16px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ─── Report Risk ────────────────────────────────────────────────────────────────
async function submitReport() {
  const type = document.getElementById('reportType').value;
  const severity = document.getElementById('reportSeverity').value;
  const description = document.getElementById('reportDescription').value.trim();
  const roadName = document.getElementById('reportRoadName').value.trim();
  const landmark = document.getElementById('reportLandmark').value.trim();

  if (!description) {
    showToast('Please enter a description', 'error');
    return;
  }

  if (!pickedLatLng) {
    showToast('Please click on the map to pick a location', 'error');
    return;
  }

  try {
    const res = await fetch('/api/risks/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        severity: parseInt(severity),
        description,
        roadName: roadName || 'Unknown Road',
        landmark,
        lat: pickedLatLng.lat,
        lng: pickedLatLng.lng
      })
    });

    const json = await res.json();
    if (json.success) {
      // Add temporary marker
      const marker = L.marker([pickedLatLng.lat, pickedLatLng.lng], {
        icon: L.divIcon({
          html: `<div class="custom-marker user-reported">${severity}</div>`,
          className: '',
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        })
      }).addTo(map);
      marker.bindPopup(createPopupHTML(json.data));
      riskMarkers.push(marker);

      // Add to allRisks
      allRisks.push(json.data);
      renderRiskList();

      // Update heatmap
      if (heatLayer) {
        map.removeLayer(heatLayer);
        initHeatLayer();
        if (heatmapVisible) heatLayer.addTo(map);
      }

      // Reset form
      document.getElementById('reportDescription').value = '';
      document.getElementById('reportRoadName').value = '';
      document.getElementById('reportLandmark').value = '';
      document.getElementById('pickedCoords').style.display = 'none';
      document.getElementById('locationPickerHint').style.display = 'flex';
      pickedLatLng = null;

      showToast('Risk reported successfully! Pending verification.');
    } else {
      showToast('Error: ' + json.error, 'error');
    }
  } catch (err) {
    showToast('Network error. Please try again.', 'error');
  }
}

// ─── Share Alert ────────────────────────────────────────────────────────────────
function shareAlert() {
  const text = document.getElementById('routeAlertText').textContent;
  if (text) {
    navigator.clipboard.writeText(`🚨 Micro-Alert: ${text}`).then(() => {
      showToast('Alert copied to clipboard!');
    }).catch(() => {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = `🚨 Micro-Alert: ${text}`;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('Alert copied to clipboard!');
    });
  }
}

// ─── Initialize ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initMap);
