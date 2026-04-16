// ─── MicroAlert Map Controller ──────────────────────────────────────────────────
// Handles Leaflet map, markers, heatmap, routing, speed tracking, prediction

// ─── Constants ──────────────────────────────────────────────────────────────────
const CHENNAI_CENTER = [13.0827, 80.2707];
const DEFAULT_ZOOM = 12;

const LANDMARKS = {
  'anna nagar': [13.0850, 80.2101], 't. nagar': [13.0418, 80.2341],
  't nagar': [13.0418, 80.2341], 'tambaram': [12.9249, 80.1445],
  'adyar': [13.0063, 80.2574], 'chennai central': [13.0827, 80.2707],
  'central': [13.0827, 80.2707], 'marina beach': [13.0500, 80.2824],
  'marina': [13.0500, 80.2824], 'vadapalani': [13.0604, 80.2185],
  'koyambedu': [13.0743, 80.2089], 'guindy': [13.0067, 80.2206],
  'sholinganallur': [12.9012, 80.2279], 'velachery': [12.9485, 80.2204],
  'egmore': [13.0734, 80.2428], 'kathipara': [13.0123, 80.2121],
  'spencer plaza': [13.0654, 80.2628], 'mylapore': [13.0368, 80.2676],
  'thiruvanmiyur': [12.9835, 80.2641], 'porur': [13.0371, 80.1527],
  'ashok nagar': [13.0376, 80.2093], 'nungambakkam': [13.0601, 80.2489],
  'gemini': [13.0628, 80.2552], 'teynampet': [13.0475, 80.2396],
  'muttukadu': [12.8256, 80.2463], 'ecr': [12.8700, 80.2470],
  'omr': [12.9500, 80.2400], 'mount road': [13.0627, 80.2707],
  'flower bazaar': [13.0868, 80.2573], 'anna salai': [13.0628, 80.2552],
  'alwarpet': [13.0336, 80.2497], 'chromepet': [12.9516, 80.1462],
  'pallavaram': [12.9675, 80.1491], 'perambur': [13.1100, 80.2400],
  'royapettah': [13.0530, 80.2620], 'kilpauk': [13.0840, 80.2420],
  'my location': null
};

// ─── State ──────────────────────────────────────────────────────────────────────
let map;
let socket;
let allRisks = [];
let riskMarkers = [];
let heatLayer = null;
let heatmapVisible = false;
let routeLayers = [];
let routeDestinationMarkers = [];
let pickedLatLng = null;
let emergencyMarkers = [];
let userLocationMarker = null;
let userAccuracyCircle = null;
let userLat = null, userLng = null;
let speedWatchId = null;
let currentSpeed = 0;
let lastSpeedLogTime = 0;
let capturedPhotos = [];

// ─── Performance & Refresh State ────────────────────────────────────────────────
const REFRESH_RISK_MS = 15000;    // Risk data refresh: 15s
const REFRESH_ALERT_MS = 10000;   // Alert poll: 10s
const FETCH_TIMEOUT_MS = 3000;    // Max wait before showing cache
let lastRiskHash = '';             // Data change detection hash
let refreshTimers = {};            // Background refresh timers
let isUpdatingBadge = false;       // Prevent badge update stampede

// ─── SessionStorage Cache Layer ─────────────────────────────────────────────────
function cacheSet(key, data) {
  try { sessionStorage.setItem('ma_' + key, JSON.stringify({ ts: Date.now(), data })); } catch (e) {}
}
function cacheGet(key, maxAgeMs = 120000) {
  try {
    const raw = sessionStorage.getItem('ma_' + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.ts > maxAgeMs) return null;
    return parsed.data;
  } catch (e) { return null; }
}
function computeDataHash(data) {
  // Simple hash from IDs + severities + cleared states
  return data.map(r => `${r.id || r._id}:${r.severity}:${r.cleared ? 1 : 0}`).join('|');
}

// ─── Map Initialization ────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', {
    center: CHENNAI_CENTER, zoom: DEFAULT_ZOOM,
    zoomControl: false, attributionControl: true
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19
  }).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.on('click', onMapClick);

  loadAllRisks();
  initSocket();
  startSpeedTracking();
}

// ─── Socket.io ──────────────────────────────────────────────────────────────────
function initSocket() {
  try {
    socket = io();
    socket.on('new-risk', (risk) => {
      allRisks.push(risk);
      renderMarkers();
      renderRiskList();
      updateAlertBadge();
    });
    socket.on('hazard-changed', () => {
      loadAllRisks();
    });
    socket.on('new-dispatch', (dispatch) => {
      showToast(`🚨 Emergency dispatch: ${dispatch.type} — Status: ${dispatch.status}`, 'success');
      updateAlertBadge();
    });
  } catch (e) {
    console.warn('Socket.io not available');
  }
}

// ─── Load All Risks (Cached + Background) ──────────────────────────────────────
async function loadAllRisks() {
  // 1. Show cached data instantly
  const cached = cacheGet('risks');
  if (cached && allRisks.length === 0) {
    allRisks = cached;
    lastRiskHash = computeDataHash(cached);
    renderMarkers();
    renderRiskList();
    initHeatLayer();
    updateAlertBadge();
  }

  // 2. Fetch fresh data with timeout
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch('/api/risks', { signal: controller.signal });
    clearTimeout(timeout);
    const json = await res.json();
    if (json.success) {
      const newHash = computeDataHash(json.data);
      // Only re-render if data actually changed
      if (newHash !== lastRiskHash) {
        lastRiskHash = newHash;
        allRisks = json.data;
        cacheSet('risks', json.data);
        renderMarkers();
        renderRiskList();
        initHeatLayer();
        updateAlertBadge();
        hideUpdatingBadge();
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      // Timeout — show subtle updating badge, use cached data
      showUpdatingBadge();
    } else {
      console.warn('Risk fetch failed:', err.message);
    }
  }
}

// ─── Background Refresh System ──────────────────────────────────────────────────
function startBackgroundRefresh() {
  // Risk data every 15s
  refreshTimers.risks = setInterval(() => {
    loadAllRisks();
  }, REFRESH_RISK_MS);

  // Alert badge every 10s
  refreshTimers.alerts = setInterval(() => {
    updateAlertBadge();
  }, REFRESH_ALERT_MS);
}

function showUpdatingBadge() {
  let badge = document.getElementById('updatingBadge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'updatingBadge';
    badge.className = 'updating-badge';
    badge.innerHTML = '🔄 Updating...';
    document.body.appendChild(badge);
  }
  badge.classList.add('visible');
}
function hideUpdatingBadge() {
  const badge = document.getElementById('updatingBadge');
  if (badge) badge.classList.remove('visible');
}

// ─── Update Alert Badge ─────────────────────────────────────────────────────────
function updateAlertBadge() {
  const activeRisks = allRisks.filter(r => !r.cleared && r.severity >= 4).length;
  const badge = document.getElementById('alertBadge');
  if (badge) badge.textContent = activeRisks;

  // Populate alert panel
  const body = document.getElementById('alertPanelBody');
  if (body && activeRisks > 0) {
    const topAlerts = allRisks.filter(r => !r.cleared && r.severity >= 4).slice(0, 5);
    body.innerHTML = topAlerts.map(r => `
      <div style="padding:8px 0;border-bottom:1px solid var(--border-color);font-size:12px;">
        <div style="font-weight:600;margin-bottom:2px;">⚠️ ${r.roadName}</div>
        <div style="color:var(--text-secondary);">${r.description?.substring(0, 80)}...</div>
      </div>
    `).join('');
  }
}

// ─── Render Risk Markers ────────────────────────────────────────────────────────
function renderMarkers() {
  riskMarkers.forEach(m => map.removeLayer(m));
  riskMarkers = [];

  allRisks.forEach(risk => {
    const [lng, lat] = risk.location.coordinates;
    const marker = L.marker([lat, lng], { icon: createRiskIcon(risk) });
    marker.bindPopup(createPopupHTML(risk), { maxWidth: 300, className: 'risk-popup' });
    marker.addTo(map);
    riskMarkers.push(marker);
  });
}

function createRiskIcon(risk) {
  const markerClass = risk.cleared ? 'cleared' : risk.type;
  const label = risk.cleared ? '✓' : risk.severity;
  return L.divIcon({
    html: `<div class="custom-marker ${markerClass}">${label}</div>`,
    className: '', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16]
  });
}

function createPopupHTML(risk) {
  const typeLabels = { sudden_brake: 'Sudden Braking', blind_turn: 'Blind Turn', habitual_violation: 'Habitual Violation', accident: '💥 Accident Zone' };
  const timeLabels = { morning_rush: '🌅 Morning Rush', afternoon: '☀️ Afternoon', evening_rush: '🌆 Evening Rush', night: '🌙 Night' };
  const weatherIcons = { clear: '☀️', rain: '🌧️', fog: '🌫️' };

  let severityDots = '';
  for (let i = 1; i <= 5; i++) {
    const ac = i <= risk.severity ? `active s${risk.severity}` : '';
    severityDots += `<div class="severity-dot ${ac}"></div>`;
  }

  const riskId = risk._id || risk.id;
  const clearedBanner = risk.cleared
    ? `<div style="background:rgba(74,222,128,0.12);border:1px solid rgba(74,222,128,0.25);border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:12px;color:#4ade80;font-weight:600;">✅ Cleared by admin</div>`
    : '';

  // Photo section — show hazard photo if available
  const photoSection = risk.photoUrl
    ? `<div class="popup-photo-section">
        <div class="popup-photo-label">📸 Hazard Photo</div>
        <div class="popup-photo-wrapper">
          <img src="${risk.photoUrl}" alt="Hazard at ${risk.roadName}" class="popup-photo" onclick="openPhotoLightbox('${risk.photoUrl}')">
          <div class="popup-photo-badge">📷 Evidence</div>
        </div>
      </div>`
    : '';

  return `
    <div class="popup-inner">
      <span class="popup-type ${risk.cleared ? 'cleared' : risk.type}">${risk.cleared ? '✅ Cleared' : typeLabels[risk.type]}</span>
      <h3>${risk.roadName}</h3>
      ${risk.landmark ? `<p style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">📍 ${risk.landmark}</p>` : ''}
      ${clearedBanner}
      ${photoSection}
      <p class="popup-desc">${risk.description}</p>
      <div class="popup-meta">
        <span>${timeLabels[risk.timeOfDay]}</span>
        <span>${weatherIcons[risk.weather]} ${risk.weather}</span>
        <span>${risk.verified ? '✅ Verified' : '⏳ Unverified'}</span>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">Severity</div>
      <div class="severity-bar">${severityDots}</div>
      <button class="popup-explain-btn" onclick="explainRisk('${riskId}')">🧠 Explain This Risk</button>
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
    radius: 30, blur: 20, maxZoom: 15, max: 1.0,
    gradient: { 0.2: '#2563EB', 0.4: '#06b6d4', 0.6: '#F59E0B', 0.8: '#f97316', 1.0: '#ef4444' }
  });
}

function toggleHeatmap() {
  const btn = document.getElementById('heatmapToggle');
  if (heatmapVisible) {
    map.removeLayer(heatLayer);
    btn.classList.remove('active');
    riskMarkers.forEach(m => m.addTo(map));
  } else {
    heatLayer.addTo(map);
    btn.classList.add('active');
    riskMarkers.forEach(m => map.removeLayer(m));
  }
  heatmapVisible = !heatmapVisible;
}

// ─── Route Scanning with Multi-Route Support ────────────────────────────────────
function fillRoute(start, end) {
  document.getElementById('startLocation').value = start;
  document.getElementById('endLocation').value = end;
  document.getElementById('startDropdown').style.display = 'none';
  document.getElementById('endDropdown').style.display = 'none';
}

async function resolveLocation(name) {
  const key = name.toLowerCase().trim();
  if (key === 'my location' && userLat) return [userLat, userLng];
  if (LANDMARKS[key]) return LANDMARKS[key];
  for (const [k, v] of Object.entries(LANDMARKS)) {
    if (v && (k.includes(key) || key.includes(k))) return v;
  }
  return await geocodeLocation(name);
}

async function geocodeLocation(query) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    if (data && data.length > 0) return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
  } catch (e) { console.warn('Geocoding failed:', e); }
  return null;
}

async function scanRoute() {
  const startInput = document.getElementById('startLocation');
  const endInput = document.getElementById('endLocation');
  const startName = startInput.value.trim();
  const endName = endInput.value.trim();

  if (!startName || !endName) {
    showToast('Please enter both start and end locations', 'error');
    return;
  }

  document.getElementById('routeLoading').classList.add('visible');
  document.getElementById('routeAlert').classList.remove('visible');
  document.getElementById('routeResults').style.display = 'none';
  document.getElementById('scanRouteBtn').disabled = true;

  let startCoords = startInput.dataset.lat ? [parseFloat(startInput.dataset.lat), parseFloat(startInput.dataset.lon)] : await resolveLocation(startName);
  let endCoords = endInput.dataset.lat ? [parseFloat(endInput.dataset.lat), parseFloat(endInput.dataset.lon)] : await resolveLocation(endName);

  if (!startCoords || !endCoords) {
    showToast('Could not find one or both locations.', 'error');
    document.getElementById('routeLoading').classList.remove('visible');
    document.getElementById('scanRouteBtn').disabled = false;
    return;
  }

  // Clear previous routes
  routeLayers.forEach(l => map.removeLayer(l));
  routeLayers = [];
  routeDestinationMarkers.forEach(m => map.removeLayer(m));
  routeDestinationMarkers = [];

  try {
    // Get multi-route results
    const routeRes = await fetch('/api/routing/find-routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startLat: startCoords[0], startLng: startCoords[1],
        endLat: endCoords[0], endLng: endCoords[1]
      })
    });
    const routeJson = await routeRes.json();

    if (routeJson.success && routeJson.data.routes.length > 0) {
      const routes = routeJson.data.routes;

      // Draw all routes (dimmed) then highlight first
      routes.forEach((route, idx) => {
        const polyline = L.polyline(route.coordinates, {
          color: route.color, weight: idx === 0 ? 5 : 3,
          opacity: idx === 0 ? 0.9 : 0.4,
          dashArray: idx === 0 ? null : '8, 8'
        }).addTo(map);
        routeLayers.push(polyline);
      });

      // Show route options panel
      const optionsEl = document.getElementById('routeOptions');
      optionsEl.innerHTML = routes.map((r, i) => {
        const hazLevel = r.hazardScore > 30 ? 'high' : r.hazardScore > 15 ? 'medium' : 'low';
        return `
          <div class="route-option ${i === 0 ? 'active' : ''}" onclick="selectRoute(${i})" id="routeOpt${i}">
            <div class="route-color-dot" style="background:${r.color}"></div>
            <div class="route-opt-info">
              <div class="route-opt-name">${r.name}</div>
              <div class="route-opt-meta">
                <span>${r.distance} km</span>
                <span>${r.duration} min</span>
              </div>
            </div>
            <div class="route-opt-hazard ${hazLevel}">${hazLevel.toUpperCase()}</div>
          </div>
        `;
      }).join('');
      document.getElementById('routeResults').style.display = 'block';

      // Update bottom route info card
      const best = routes[0];
      document.getElementById('routeETA').textContent = `${best.duration} min`;
      document.getElementById('routeDistance').textContent = `${best.distance} km`;
      const hazLevel = best.hazardScore > 30 ? '🔴 High' : best.hazardScore > 15 ? '🟡 Med' : '🟢 Low';
      document.getElementById('routeHazard').textContent = hazLevel;
      document.getElementById('routeInfoCard').style.display = 'block';

      // Add start/end markers
      addDestinationMarkers(startCoords, endCoords, startName, endName);
      map.fitBounds(routeLayers[0].getBounds(), { padding: [60, 60] });
    }

    // Fetch risks along route for alert
    const riskRes = await fetch(`/api/risks/along-route?startLat=${startCoords[0]}&startLng=${startCoords[1]}&endLat=${endCoords[0]}&endLng=${endCoords[1]}`);
    const riskJson = await riskRes.json();

    if (riskJson.success && riskJson.data.length > 0) {
      await getCondensedAlert(riskJson.data);
    } else {
      const alertBox = document.getElementById('routeAlert');
      alertBox.classList.add('visible');
      document.getElementById('routeAlertText').textContent = '✅ No significant risks along this route. Drive safely!';
    }
  } catch (err) {
    console.error('Route scan error:', err);
    showToast('Error scanning route.', 'error');
  } finally {
    document.getElementById('routeLoading').classList.remove('visible');
    document.getElementById('scanRouteBtn').disabled = false;
  }
}

function selectRoute(idx) {
  routeLayers.forEach((l, i) => {
    l.setStyle({
      weight: i === idx ? 5 : 3,
      opacity: i === idx ? 0.9 : 0.3,
      dashArray: i === idx ? null : '8, 8'
    });
    if (i === idx) l.bringToFront();
  });

  document.querySelectorAll('.route-option').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });
}

function addDestinationMarkers(startCoords, endCoords, startName, endName) {
  const startMarker = L.marker(startCoords, {
    icon: L.divIcon({
      html: `<div class="destination-marker start-marker">
               <div class="dest-marker-pin"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg></div>
               <div class="dest-marker-label">START</div>
               <div class="dest-marker-pulse"></div>
             </div>`,
      className: '', iconSize: [40, 56], iconAnchor: [20, 52]
    }), zIndexOffset: 900
  }).addTo(map);
  startMarker.bindPopup(`<div class="popup-inner"><span class="popup-type" style="background:rgba(16,185,129,0.15);color:#10b981;">START</span><h3>${startName}</h3></div>`);
  routeDestinationMarkers.push(startMarker);

  const endMarker = L.marker(endCoords, {
    icon: L.divIcon({
      html: `<div class="destination-marker end-marker">
               <div class="dest-marker-pin"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></div>
               <div class="dest-marker-label">END</div>
               <div class="dest-marker-pulse"></div>
             </div>`,
      className: '', iconSize: [40, 56], iconAnchor: [20, 52]
    }), zIndexOffset: 900
  }).addTo(map);
  endMarker.bindPopup(`<div class="popup-inner"><span class="popup-type" style="background:rgba(239,68,68,0.15);color:#ef4444;">DESTINATION</span><h3>${endName}</h3></div>`);
  routeDestinationMarkers.push(endMarker);
}

// ─── Speed Tracking ─────────────────────────────────────────────────────────────
function startSpeedTracking() {
  if (!navigator.geolocation) return;

  speedWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      userLat = pos.coords.latitude;
      userLng = pos.coords.longitude;
      currentSpeed = pos.coords.speed ? pos.coords.speed * 3.6 : 0; // m/s to km/h

      // Update nav location
      reverseGeocode(userLat, userLng).then(name => {
        if (name) {
          const el = document.getElementById('navLocationText');
          if (el) el.textContent = name;
        }
      });

      // Broadcast location via socket
      if (socket) {
        socket.emit('location-update', { lat: userLat, lng: userLng, speed: currentSpeed });
      }

      // Log speed every 30 seconds
      const now = Date.now();
      if (now - lastSpeedLogTime > 30000 && currentSpeed > 0) {
        lastSpeedLogTime = now;
        logSpeed(currentSpeed, userLat, userLng);
      }
    },
    (err) => { /* silent fail */ },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
}

async function logSpeed(speed, lat, lng) {
  try {
    const res = await fetch('/api/speed/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed, speedLimit: 40, lat, lng })
    });
    const json = await res.json();
    if (json.success) {
      updateSpeedBadge(json.data.rating);
    }
  } catch (e) { /* silent */ }
}

function updateSpeedBadge(rating) {
  const starsEl = document.getElementById('speedStars');
  const labelEl = document.querySelector('.speed-label');
  if (!starsEl || !labelEl) return;

  const stars = '⭐'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating));
  starsEl.textContent = stars;
  labelEl.textContent = rating.toFixed(1);
}

// ─── Accident Risk Prediction ───────────────────────────────────────────────────
async function analyzePrediction() {
  const center = map.getCenter();
  const weather = document.getElementById('predWeather')?.value || 'clear';
  const roadType = document.getElementById('predRoadType')?.value || 'urban';

  const hour = new Date().getHours();
  let timeOfDay = 'afternoon';
  if (hour >= 6 && hour < 10) timeOfDay = 'morning_rush';
  else if (hour >= 16 && hour < 20) timeOfDay = 'evening_rush';
  else if (hour >= 20 || hour < 6) timeOfDay = 'night';

  try {
    const res = await fetch('/api/prediction/risk-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lat: center.lat, lng: center.lng,
        speed: currentSpeed, speedLimit: 40,
        weather, timeOfDay, roadType
      })
    });
    const json = await res.json();

    if (json.success) {
      const d = json.data;
      const gauge = document.getElementById('gaugeCircle');
      const gaugeVal = document.getElementById('gaugeValue');
      const gaugeLbl = document.getElementById('gaugeLabel');
      const details = document.getElementById('predictionDetails');

      gaugeVal.textContent = d.totalScore;
      gaugeLbl.textContent = d.riskLabel;
      gauge.style.borderColor = d.riskColor;
      gaugeVal.style.color = d.riskColor;

      details.innerHTML = `
        <div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;">
          <div style="display:flex;justify-content:space-between;"><span>History</span><span style="font-weight:600;">${d.breakdown.accidentHistory}/50</span></div>
          <div style="display:flex;justify-content:space-between;"><span>Speed</span><span style="font-weight:600;">${d.breakdown.speedAnalysis}/25</span></div>
          <div style="display:flex;justify-content:space-between;"><span>Weather</span><span style="font-weight:600;">${d.breakdown.weather}/15</span></div>
          <div style="display:flex;justify-content:space-between;"><span>Time</span><span style="font-weight:600;">${d.breakdown.timeOfDay}/10</span></div>
        </div>
        <div style="font-size:11px;color:var(--accent-amber);margin-top:6px;">
          💡 ${d.recommendations[0]}
        </div>
      `;
    }
  } catch (err) {
    showToast('Risk prediction failed', 'error');
  }
}

// ─── Map Click ──────────────────────────────────────────────────────────────────
function onMapClick(e) {
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
  if (overlay.classList.contains('visible')) { closeEmergency(); return; }

  const center = map.getCenter();
  try {
    const res = await fetch(`/api/emergency?lat=${center.lat}&lng=${center.lng}`);
    const json = await res.json();
    if (json.success) {
      document.getElementById('emergencyList').innerHTML = json.data.map(s => `
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

      emergencyMarkers.forEach(m => map.removeLayer(m));
      emergencyMarkers = [];
      json.data.forEach(s => {
        const m = L.marker([s.lat, s.lng], {
          icon: L.divIcon({ html: `<div style="font-size:24px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));">${s.icon}</div>`, className: '', iconSize: [30, 30], iconAnchor: [15, 15] })
        }).addTo(map);
        m.bindPopup(`<div class="popup-inner"><h3>${s.name}</h3><p class="popup-desc">${s.address}<br>📞 ${s.phone}</p></div>`);
        emergencyMarkers.push(m);
      });
    }
  } catch (err) { showToast('Could not load emergency services', 'error'); }
}

function closeEmergency() {
  document.getElementById('emergencyOverlay').classList.remove('visible');
  document.getElementById('emergencyBtn').classList.remove('active');
  emergencyMarkers.forEach(m => map.removeLayer(m));
  emergencyMarkers = [];
}

function flyToEmergency(lat, lng) { map.flyTo([lat, lng], 15, { duration: 1 }); }

// ─── Risk List ──────────────────────────────────────────────────────────────────
function renderRiskList() {
  const top5 = [...allRisks].sort((a, b) => b.severity - a.severity).slice(0, 5);
  document.getElementById('riskCount').textContent = allRisks.length;

  const typeLabels = { sudden_brake: 'Sudden Brake', blind_turn: 'Blind Turn', habitual_violation: 'Violation', accident: 'Accident' };
  document.getElementById('riskList').innerHTML = top5.map(r => {
    const [lng, lat] = r.location.coordinates;
    return `
      <div class="risk-item" onclick="flyToRisk(${lat}, ${lng})">
        <div class="risk-severity s${r.severity}">${r.severity}</div>
        <div class="risk-info">
          <h4>${r.roadName}</h4>
          <p>${r.description}</p>
          <div class="risk-meta"><span class="risk-tag ${r.type}">${typeLabels[r.type]}</span></div>
        </div>
      </div>
    `;
  }).join('');
}

function flyToRisk(lat, lng) {
  map.flyTo([lat, lng], 16, { duration: 1 });
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('open');
}

// ─── Utility Functions ──────────────────────────────────────────────────────────
function centerMap() { map.flyTo(CHENNAI_CENTER, DEFAULT_ZOOM, { duration: 1 }); }

function locateMe() {
  const btn = document.getElementById('locateBtn');
  if (!navigator.geolocation) { showToast('Geolocation not supported', 'error'); return; }
  btn.classList.add('locating');
  showToast('Detecting your location…', 'success');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      userLat = latitude; userLng = longitude;
      if (userLocationMarker) map.removeLayer(userLocationMarker);
      if (userAccuracyCircle) map.removeLayer(userAccuracyCircle);

      userAccuracyCircle = L.circle([latitude, longitude], { radius: accuracy, color: '#2563EB', fillColor: '#2563EB', fillOpacity: 0.08, weight: 1, opacity: 0.3 }).addTo(map);
      userLocationMarker = L.marker([latitude, longitude], {
        icon: L.divIcon({
          html: `<div class="my-location-dot"><div class="my-location-pulse"></div><div class="my-location-core"></div></div>`,
          className: '', iconSize: [24, 24], iconAnchor: [12, 12]
        }), zIndexOffset: 1000
      }).addTo(map);

      const zoomLevel = accuracy < 100 ? 17 : accuracy < 500 ? 15 : 14;
      map.flyTo([latitude, longitude], zoomLevel, { duration: 1.5 });

      const startInput = document.getElementById('startLocation');
      if (startInput && !startInput.value) startInput.value = 'My Location';

      reverseGeocode(latitude, longitude).then(name => {
        if (name) showToast(`📍 Located: ${name}`, 'success');
        else showToast('📍 Location found!', 'success');
      });

      btn.classList.remove('locating');
      btn.classList.add('active');
    },
    (err) => {
      btn.classList.remove('locating');
      showToast('Could not detect location', 'error');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
  );
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16`, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    if (data && data.address) {
      const a = data.address;
      return [a.road || a.neighbourhood || '', a.suburb || a.city || ''].filter(Boolean).join(', ') || null;
    }
  } catch (e) {}
  return null;
}

function togglePanel(panelId) { document.getElementById(panelId).classList.toggle('collapsed'); }

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${type === 'success' ? '✅' : '❌'} ${message}`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(16px)'; setTimeout(() => toast.remove(), 300); }, 3500);
}

// ─── Report Risk ────────────────────────────────────────────────────────────────
async function submitReport() {
  const type = document.getElementById('reportType').value;
  const severity = document.getElementById('reportSeverity').value;
  const description = document.getElementById('reportDescription').value.trim();
  const roadName = document.getElementById('reportRoadName').value.trim();
  const landmark = document.getElementById('reportLandmark').value.trim();

  if (!description) { showToast('Please enter a description', 'error'); return; }
  if (!pickedLatLng) { showToast('Please click on the map to pick a location', 'error'); return; }

  // Upload photo if captured
  let photoUrl = null;
  if (capturedPhotos.length > 0) {
    try {
      const formData = new FormData();
      formData.append('photo', capturedPhotos[0]);
      const uploadRes = await fetch('/api/upload/photo', { method: 'POST', body: formData });
      const uploadJson = await uploadRes.json();
      if (uploadJson.success) {
        photoUrl = uploadJson.data.url;
      }
    } catch (e) {
      console.warn('Photo upload failed:', e);
    }
  }

  try {
    const res = await fetch('/api/risks/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, severity: parseInt(severity), description, roadName: roadName || 'Unknown Road', landmark, lat: pickedLatLng.lat, lng: pickedLatLng.lng, photoUrl })
    });
    const json = await res.json();
    if (json.success) {
      const marker = L.marker([pickedLatLng.lat, pickedLatLng.lng], {
        icon: L.divIcon({ html: `<div class="custom-marker user-reported">${severity}</div>`, className: '', iconSize: [28, 28], iconAnchor: [14, 14] })
      }).addTo(map);
      marker.bindPopup(createPopupHTML(json.data));
      riskMarkers.push(marker);
      allRisks.push(json.data);
      renderRiskList();
      if (heatLayer) { map.removeLayer(heatLayer); initHeatLayer(); if (heatmapVisible) heatLayer.addTo(map); }

      document.getElementById('reportDescription').value = '';
      document.getElementById('reportRoadName').value = '';
      document.getElementById('reportLandmark').value = '';
      document.getElementById('pickedCoords').style.display = 'none';
      document.getElementById('locationPickerHint').style.display = 'flex';
      pickedLatLng = null;
      clearCapturedPhotos();
      showToast('Risk reported successfully!');
    } else { showToast('Error: ' + json.error, 'error'); }
  } catch (err) { showToast('Network error.', 'error'); }
}

function shareAlert() {
  const text = document.getElementById('routeAlertText').textContent;
  if (text) {
    navigator.clipboard.writeText(`🚨 MicroAlert: ${text}`).then(() => showToast('Alert copied!')).catch(() => showToast('Alert copied!'));
  }
}

// ─── Camera / Photo Capture ─────────────────────────────────────────────────────
function openCamera() {
  const input = document.getElementById('cameraInput');
  if (input) input.click();
}

async function handleCameraCapture(input) {
  const files = input.files;
  if (!files || files.length === 0) return;

  for (let i = 0; i < files.length && capturedPhotos.length < 3; i++) {
    // Compress image before storing
    const compressed = await compressImage(files[i], 800, 0.75);
    capturedPhotos.push(compressed);
  }

  // Auto-attach GPS to the report
  autoAttachGPS();

  renderPhotoPreview();
  showToast(`📸 ${capturedPhotos.length} photo(s) compressed & attached!`);
}

// ─── Image Compression (max width, JPEG quality) ────────────────────────────────
function compressImage(file, maxWidth = 800, quality = 0.75) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          const compressed = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
          resolve(compressed);
        }, 'image/jpeg', quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ─── Auto-Attach GPS to Report ──────────────────────────────────────────────────
function autoAttachGPS() {
  if (pickedLatLng) return; // Already picked
  if (userLat && userLng) {
    pickedLatLng = { lat: userLat, lng: userLng };
    const pickedEl = document.getElementById('pickedCoords');
    const latEl = document.getElementById('pickedLat');
    const lngEl = document.getElementById('pickedLng');
    const hintEl = document.getElementById('locationPickerHint');
    if (pickedEl) pickedEl.style.display = 'flex';
    if (latEl) latEl.textContent = userLat.toFixed(6);
    if (lngEl) lngEl.textContent = userLng.toFixed(6);
    if (hintEl) hintEl.style.display = 'none';
    showToast('📍 GPS location auto-attached!', 'success');
  } else {
    // Try to get GPS now
    navigator.geolocation?.getCurrentPosition((pos) => {
      pickedLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const pickedEl = document.getElementById('pickedCoords');
      const latEl = document.getElementById('pickedLat');
      const lngEl = document.getElementById('pickedLng');
      if (pickedEl) pickedEl.style.display = 'flex';
      if (latEl) latEl.textContent = pos.coords.latitude.toFixed(6);
      if (lngEl) lngEl.textContent = pos.coords.longitude.toFixed(6);
      showToast('📍 GPS location auto-attached!', 'success');
    }, () => {
      showToast('📍 Please tap on the map to set hazard location.', 'error');
    }, { enableHighAccuracy: true, timeout: 5000 });
  }
}

function renderPhotoPreview() {
  const container = document.getElementById('photoPreviewContainer');
  if (!container) return;

  if (capturedPhotos.length === 0) {
    container.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  container.style.display = 'flex';
  container.innerHTML = capturedPhotos.map((photo, idx) => {
    const url = URL.createObjectURL(photo);
    return `<div class="photo-preview-item">
      <img src="${url}" alt="Hazard photo ${idx + 1}">
      <button class="photo-remove-btn" onclick="removePhoto(${idx})">✕</button>
    </div>`;
  }).join('');
}

function removePhoto(idx) {
  capturedPhotos.splice(idx, 1);
  renderPhotoPreview();
}

function clearCapturedPhotos() {
  capturedPhotos = [];
  renderPhotoPreview();
  const input = document.getElementById('cameraInput');
  if (input) input.value = '';
}

// ─── Photo Lightbox ─────────────────────────────────────────────────────────────
function openPhotoLightbox(photoUrl) {
  let lightbox = document.getElementById('photoLightbox');
  if (!lightbox) {
    lightbox = document.createElement('div');
    lightbox.id = 'photoLightbox';
    lightbox.className = 'photo-lightbox';
    lightbox.onclick = () => lightbox.classList.remove('visible');
    lightbox.innerHTML = `<div class="lightbox-content"><img id="lightboxImg" src="" alt="Hazard photo"><button class="lightbox-close" onclick="document.getElementById('photoLightbox').classList.remove('visible')">✕</button></div>`;
    document.body.appendChild(lightbox);
  }
  document.getElementById('lightboxImg').src = photoUrl;
  lightbox.classList.add('visible');
}

// ─── Autocomplete ───────────────────────────────────────────────────────────────
let autocompleteTimers = {};
function setupAutocomplete(inputId, dropdownId) {
  const input = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  input.addEventListener('input', () => {
    const query = input.value.trim();
    if (autocompleteTimers[inputId]) clearTimeout(autocompleteTimers[inputId]);
    if (query.length < 3) { dropdown.style.display = 'none'; return; }
    autocompleteTimers[inputId] = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`, { headers: { 'Accept-Language': 'en' } });
        const results = await res.json();
        if (results && results.length > 0) {
          dropdown.innerHTML = results.map(r => {
            const dn = r.display_name.length > 60 ? r.display_name.substring(0, 60) + '…' : r.display_name;
            return `<div class="autocomplete-item" data-lat="${r.lat}" data-lon="${r.lon}" data-name="${r.display_name.split(',').slice(0, 3).join(',')}"><span class="ac-icon">📍</span><span class="ac-text">${dn}</span></div>`;
          }).join('');
          dropdown.style.display = 'block';
          dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
              input.value = item.dataset.name;
              input.dataset.lat = item.dataset.lat;
              input.dataset.lon = item.dataset.lon;
              dropdown.style.display = 'none';
            });
          });
        } else { dropdown.innerHTML = '<div class="autocomplete-item no-results"><span class="ac-text">No results</span></div>'; dropdown.style.display = 'block'; }
      } catch (e) { dropdown.style.display = 'none'; }
    }, 350);
  });
  document.addEventListener('click', (e) => { if (!input.contains(e.target) && !dropdown.contains(e.target)) dropdown.style.display = 'none'; });
}

// ─── Mobile Sidebar ─────────────────────────────────────────────────────────────
document.getElementById('sidebarToggle')?.addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// ─── Initialize ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupAutocomplete('startLocation', 'startDropdown');
  setupAutocomplete('endLocation', 'endDropdown');
  startBackgroundRefresh();
  // Auto-start voice assistant (Section B)
  setTimeout(() => { autoStartVoice(); }, 1500);
});
