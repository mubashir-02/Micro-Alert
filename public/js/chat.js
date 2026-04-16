// ─── Micro-Alert Chat / LLM Controller ──────────────────────────────────────────
// Handles all LLM API interactions: explain risk, ask about area, condensed alert

let askAreaLocationMarker = null;
let askAreaAccuracyCircle = null;
let askAreaRisksLayer = null;
let aiLocationMarkers = []; // Temporary markers for AI-mentioned locations

// ─── Plot AI-mentioned locations on the map ─────────────────────────────────────
async function plotAILocations(mentionedLocations, riskLocations) {
  // Clear previous AI location markers
  clearAILocationMarkers();

  if ((!mentionedLocations || mentionedLocations.length === 0) && (!riskLocations || riskLocations.length === 0)) return;

  const plotted = new Set();  // Track already plotted names to avoid duplicates
  const allLatLngs = [];

  // 1. First try to match mentioned locations against the LANDMARKS dictionary and risk data
  for (const loc of (mentionedLocations || [])) {
    const name = loc.name;
    if (!name || plotted.has(name.toLowerCase())) continue;

    let coords = null;

    // Check LANDMARKS dictionary (from map.js)
    if (typeof LANDMARKS !== 'undefined') {
      const key = name.toLowerCase().trim();
      for (const [k, v] of Object.entries(LANDMARKS)) {
        if (v && (k.includes(key) || key.includes(k) || key.includes(k.split(' ')[0]))) {
          coords = v;
          break;
        }
      }
    }

    // Check against risk data coordinates
    if (!coords && riskLocations) {
      for (const rl of riskLocations) {
        const rlName = (rl.name || '').toLowerCase();
        const rlLandmark = (rl.landmark || '').toLowerCase();
        const searchName = name.toLowerCase();
        if (rlName.includes(searchName) || searchName.includes(rlName) ||
            rlLandmark.includes(searchName) || searchName.includes(rlLandmark)) {
          coords = [rl.lat, rl.lng];
          break;
        }
      }
    }

    // Geocode via Nominatim as last resort
    if (!coords) {
      try {
        const query = name.includes('Chennai') ? name : `${name}, Chennai, India`;
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`, { headers: { 'Accept-Language': 'en' } });
        const data = await res.json();
        if (data && data.length > 0) {
          coords = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
        }
      } catch (e) { /* silent */ }
    }

    if (coords) {
      addAILocationMarker(coords, name);
      allLatLngs.push(coords);
      plotted.add(name.toLowerCase());
    }
  }

  // 2. Also plot risk locations that have coordinates directly
  for (const rl of (riskLocations || [])) {
    const name = rl.name || rl.landmark || '';
    if (!name || plotted.has(name.toLowerCase())) continue;
    if (rl.lat && rl.lng) {
      addAILocationMarker([rl.lat, rl.lng], name, rl.severity);
      allLatLngs.push([rl.lat, rl.lng]);
      plotted.add(name.toLowerCase());
    }
  }

  // Fit map to show all AI markers if we have some
  if (allLatLngs.length > 0 && typeof map !== 'undefined' && map) {
    try {
      map.fitBounds(allLatLngs, { padding: [60, 60], maxZoom: 14 });
    } catch (e) { /* silent */ }
  }
}

function addAILocationMarker(coords, name, severity) {
  if (typeof L === 'undefined' || !map) return;

  const sevColor = severity >= 4 ? '#ef4444' : severity === 3 ? '#f97316' : '#06b6d4';

  const marker = L.marker(coords, {
    icon: L.divIcon({
      html: `<div class="ai-location-marker">
               <div class="ai-loc-pulse"></div>
               <div class="ai-loc-dot" style="background:${sevColor};box-shadow:0 0 12px ${sevColor}"></div>
               <div class="ai-loc-label">${name}</div>
             </div>`,
      className: '',
      iconSize: [120, 50],
      iconAnchor: [60, 25]
    }),
    zIndexOffset: 800
  }).addTo(map);

  marker.bindPopup(
    `<div class="popup-inner">
      <span class="popup-type" style="background:rgba(6,182,212,0.15);color:#06b6d4;">📍 AI MENTION</span>
      <h3>${name}</h3>
      <p class="popup-desc" style="font-size:11px;color:var(--text-secondary);">This location was identified in the AI risk analysis for the current area.</p>
    </div>`,
    { maxWidth: 260, className: 'risk-popup' }
  );

  aiLocationMarkers.push(marker);
}

function clearAILocationMarkers() {
  aiLocationMarkers.forEach(m => {
    try { map.removeLayer(m); } catch (e) {}
  });
  aiLocationMarkers = [];
}

// ─── Explain a specific risk ────────────────────────────────────────────────────
async function explainRisk(riskId) {
  const resultEl = document.getElementById(`explain-${riskId}`);
  if (!resultEl) return;

  // Toggle visibility if already showing
  if (resultEl.style.display === 'block') {
    resultEl.style.display = 'none';
    return;
  }

  // Find the risk data (use == for loose comparison since MySQL IDs are integers
  // but the popup onclick passes them as strings)
  const risk = allRisks.find(r => r._id == riskId || r.id == riskId);
  if (!risk) {
    resultEl.innerHTML = '<em>Risk data not found.</em>';
    resultEl.style.display = 'block';
    return;
  }

  // Show loading
  resultEl.innerHTML = '<div class="loading visible"><div class="spinner"></div><span class="loading-text">AI analyzing…</span></div>';
  resultEl.style.display = 'block';

  try {
    const res = await fetch('/api/llm/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        risks: [risk],
        question: `Why is "${risk.roadName}" near "${risk.landmark}" risky? What should a commuter do?`
      })
    });

    const json = await res.json();
    if (json.success) {
      resultEl.innerHTML = `<strong style="color:var(--accent-cyan);font-size:11px;">🧠 AI Insight</strong><br><span style="font-size:12px;line-height:1.5;">${json.answer}</span>`;
    } else {
      resultEl.innerHTML = `<em style="color:var(--risk-orange);font-size:12px;">⚠️ ${json.error || 'AI service unavailable. Check your API key.'}</em>`;
    }
  } catch (err) {
    resultEl.innerHTML = `<em style="color:var(--risk-orange);font-size:12px;">⚠️ Network error. Please try again.</em>`;
  }
}

// ─── Ask About Current Area ─────────────────────────────────────────────────────
function getCurrentBrowserLocation(options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(err),
      options
    );
  });
}

async function askAboutArea(useCurrentLocation = false) {
  const loading = document.getElementById('askLoading');
  const resultBox = document.getElementById('askResult');
  const resultText = document.getElementById('askResultText');
  const btn = document.getElementById('askAreaBtn');

  // Show loading
  loading.classList.add('visible');
  resultBox.classList.remove('visible');
  btn.disabled = true;

  let center = map.getCenter();
  if (useCurrentLocation) {
    try {
      const loc = await getCurrentBrowserLocation();
      center = { lat: loc.lat, lng: loc.lng };
      if (typeof map?.flyTo === 'function') map.flyTo([loc.lat, loc.lng], 16, { duration: 1 });

      // Drop/update a "you are here" marker for this analysis.
      if (typeof L !== 'undefined' && map && typeof map.addLayer === 'function') {
        try {
          if (askAreaLocationMarker) map.removeLayer(askAreaLocationMarker);
          if (askAreaAccuracyCircle) map.removeLayer(askAreaAccuracyCircle);

          const accuracy = Number.isFinite(loc.accuracy) ? loc.accuracy : 60;
          askAreaAccuracyCircle = L.circle([loc.lat, loc.lng], {
            radius: accuracy,
            color: '#2563EB',
            fillColor: '#2563EB',
            fillOpacity: 0.08,
            weight: 1,
            opacity: 0.3
          }).addTo(map);

          askAreaLocationMarker = L.marker([loc.lat, loc.lng], {
            icon: L.divIcon({
              html: `<div class="my-location-dot"><div class="my-location-pulse"></div><div class="my-location-core"></div></div>`,
              className: '',
              iconSize: [24, 24],
              iconAnchor: [12, 12]
            }),
            zIndexOffset: 1000
          }).addTo(map);
        } catch (e) {
          // ignore marker rendering errors
        }
      }
    } catch (e) {
      // If user denies GPS or it fails, fall back to current map center.
    }
  }

  const bounds = map.getBounds();
  // Calculate rough radius from bounds
  const ne = bounds.getNorthEast();
  const dLat = ne.lat - center.lat;
  const dLng = ne.lng - center.lng;
  const radius = Math.max(
    Math.sqrt(dLat * dLat + dLng * dLng) * 111000, // Convert to meters roughly
    500
  );

  try {
    // Fetch nearby risks
    const nearbyRes = await fetch(`/api/risks/nearby?lat=${center.lat}&lng=${center.lng}&radius=${Math.min(radius, 5000)}`);
    const nearbyJson = await nearbyRes.json();

    if (!nearbyJson.success || !nearbyJson.data.features || nearbyJson.data.features.length === 0) {
      resultText.textContent = 'No risk data available for the current view area. Try zooming into a specific Chennai neighbourhood.';
      resultBox.classList.add('visible');
      loading.classList.remove('visible');
      btn.disabled = false;
      return;
    }

    // Plot nearby risks on map (temporary overlay for this analysis)
    if (typeof L !== 'undefined' && map) {
      if (!askAreaRisksLayer) askAreaRisksLayer = L.layerGroup().addTo(map);
      askAreaRisksLayer.clearLayers();

      const latLngs = [];
      let addedLayers = 0;
      let skippedFeatures = 0;
      for (const f of nearbyJson.data.features) {
        try {
          const props = f.properties || {};
          const coords = f.geometry?.coordinates;
          if (!coords || coords.length < 2) { skippedFeatures++; continue; }
          const [lng, lat] = coords;
          latLngs.push([lat, lng]);

          const risk = {
            _id: props._id,
            id: props._id,
            type: props.type,
            severity: props.severity,
            description: props.description,
            roadName: props.roadName,
            landmark: props.landmark,
            timeOfDay: props.timeOfDay,
            weather: props.weather,
            verified: props.verified,
            cleared: false,
            location: { type: 'Point', coordinates: [lng, lat] }
          };

          // Prefer the same custom marker/popup styles from map.js, but fall back to a simple circle marker.
          let layer = null;
          try {
            const icon = (typeof createRiskIcon === 'function') ? createRiskIcon(risk) : null;
            layer = icon ? L.marker([lat, lng], { icon, zIndexOffset: 500 }) : null;
            if (layer && typeof createPopupHTML === 'function') {
              layer.bindPopup(createPopupHTML(risk), { maxWidth: 300, className: 'risk-popup' });
            }
          } catch (e) {
            layer = null;
          }

          if (!layer) {
            const sev = Math.max(1, Math.min(5, parseInt(risk.severity, 10) || 1));
            const color = sev >= 5 ? '#ef4444' : sev === 4 ? '#f97316' : sev === 3 ? '#F59E0B' : sev === 2 ? '#06b6d4' : '#2563EB';
            layer = L.circleMarker([lat, lng], {
              radius: 9,
              color,
              weight: 2,
              fillColor: color,
              fillOpacity: 0.35
            });
            const title = `${risk.roadName || 'Unknown road'} (severity ${sev})`;
            const desc = risk.description ? `<div style="margin-top:6px;color:var(--text-secondary);">${risk.description}</div>` : '';
            layer.bindPopup(`<div class="popup-inner"><div style="font-weight:700;">${title}</div>${desc}</div>`, { maxWidth: 300 });
          }

          askAreaRisksLayer.addLayer(layer);
          addedLayers++;
        } catch (e) {
          skippedFeatures++;
        }
      }

      if (latLngs.length > 0 && typeof map.fitBounds === 'function') {
        try {
          map.fitBounds(latLngs, { padding: [24, 24], maxZoom: 16 });
        } catch (e) {}
      }
    }

    // Prepare risks for LLM
    const risks = nearbyJson.data.features.map(f => ({
      type: f.properties.type,
      severity: f.properties.severity,
      description: f.properties.description,
      roadName: f.properties.roadName,
      landmark: f.properties.landmark,
      timeOfDay: f.properties.timeOfDay,
      weather: f.properties.weather
    }));

    // Call summarize API
    const llmRes = await fetch('/api/llm/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        risks,
        question: 'What is the main risk pattern here? What should commuters watch out for?'
      })
    });

    const llmJson = await llmRes.json();
    if (llmJson.success) {
      // Client-side fallback: strip |||LOCATIONS||| block from answer text
      let cleanAnswer = llmJson.answer || '';
      let clientParsedLocations = [];

      // Pattern 1: |||LOCATIONS|||...|||END|||
      const locBlockRegex1 = /\|\|\|LOCATIONS\|\|\|\s*([\s\S]*?)\s*\|\|\|END\|\|\|/;
      const locMatch1 = cleanAnswer.match(locBlockRegex1);
      if (locMatch1) {
        cleanAnswer = cleanAnswer.replace(locBlockRegex1, '').trim();
        try { clientParsedLocations = JSON.parse(locMatch1[1].trim()); } catch (e) {}
      }

      // Pattern 2: |||LOCATIONS||| followed by JSON (no END delimiter)
      if (clientParsedLocations.length === 0) {
        const locMatch2 = cleanAnswer.match(/\|\|\|LOCATIONS\|\|\|\s*(\[[\s\S]*)/);
        if (locMatch2) {
          cleanAnswer = cleanAnswer.replace(/\|\|\|LOCATIONS\|\|\|[\s\S]*$/, '').trim();
          let jsonStr = locMatch2[1].trim();
          if (!jsonStr.endsWith(']')) {
            const lastBrace = jsonStr.lastIndexOf('}');
            if (lastBrace > 0) jsonStr = jsonStr.substring(0, lastBrace + 1) + ']';
          }
          try { clientParsedLocations = JSON.parse(jsonStr); } catch (e) {}
        }
      }

      // Pattern 3: Trailing JSON array with "name" keys
      if (clientParsedLocations.length === 0) {
        const trailingJson = cleanAnswer.match(/(\[\s*\{"name"\s*:\s*"[^"]+"\}[\s\S]*$)/);
        if (trailingJson) {
          cleanAnswer = cleanAnswer.replace(trailingJson[0], '').trim();
          let jsonStr = trailingJson[1].trim();
          if (!jsonStr.endsWith(']')) {
            const lastBrace = jsonStr.lastIndexOf('}');
            if (lastBrace > 0) jsonStr = jsonStr.substring(0, lastBrace + 1) + ']';
          }
          try { clientParsedLocations = JSON.parse(jsonStr); } catch (e) {}
        }
      }

      // Final cleanup: strip any remaining delimiters or stray JSON fragments
      cleanAnswer = cleanAnswer.replace(/\|\|\|LOCATIONS\|\|\|/g, '').replace(/\|\|\|END\|\|\|/g, '').trim();
      cleanAnswer = cleanAnswer.replace(/\[?\s*\{"name"\s*:\s*"[^"]*"\}\s*(,\s*\{"name"\s*:\s*"[^"]*"\}\s*)*\]?/g, '').trim();

      resultText.textContent = cleanAnswer;

      // Merge locations from: backend parsed + client parsed + text scanning
      let allMentioned = [
        ...(llmJson.mentionedLocations || []),
        ...clientParsedLocations
      ];

      // Scan the answer text for LANDMARKS names as another fallback
      if (typeof LANDMARKS !== 'undefined') {
        const answerLower = cleanAnswer.toLowerCase();
        for (const [name, coords] of Object.entries(LANDMARKS)) {
          if (coords && name.length > 3 && answerLower.includes(name)) {
            // Check if not already in the list
            const exists = allMentioned.some(l =>
              l.name.toLowerCase().includes(name) || name.includes(l.name.toLowerCase())
            );
            if (!exists) {
              allMentioned.push({ name: name.charAt(0).toUpperCase() + name.slice(1) });
            }
          }
        }
      }

      // Deduplicate
      const seen = new Set();
      allMentioned = allMentioned.filter(l => {
        const key = l.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Plot AI-mentioned locations on the map as temporary markers
      plotAILocations(allMentioned, llmJson.riskLocations);
    } else {
      resultText.textContent = '⚠️ ' + (llmJson.error || 'AI service unavailable. Please check your API key configuration.');
    }

    resultBox.classList.add('visible');
  } catch (err) {
    resultText.textContent = '⚠️ Network error. Please try again.';
    resultBox.classList.add('visible');
  } finally {
    loading.classList.remove('visible');
    btn.disabled = false;
  }
}

async function askAboutMyLocation() {
  return askAboutArea(true);
}

// ─── Get Condensed Alert for Route ──────────────────────────────────────────────
async function getCondensedAlert(risks) {
  try {
    const res = await fetch('/api/llm/condensed-alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ risks })
    });

    const json = await res.json();
    const alertBox = document.getElementById('routeAlert');
    const alertText = document.getElementById('routeAlertText');

    if (json.success) {
      alertText.textContent = json.alert;
      alertBox.classList.remove('error');
    } else {
      // Fallback: generate a local summary
      const topRisks = risks.slice(0, 3);
      const summary = topRisks.map(r => {
        const typeLabels = { sudden_brake: '🛑 Braking', blind_turn: '🔄 Blind turn', habitual_violation: '⚠️ Violation' };
        return `${typeLabels[r.type]} at ${r.roadName}`;
      }).join(' · ');
      alertText.textContent = summary || 'Route analysis complete. Drive safely!';
      alertBox.classList.remove('error');
    }

    alertBox.classList.add('visible');
  } catch (err) {
    // Provide fallback summary without LLM
    const alertBox = document.getElementById('routeAlert');
    const alertText = document.getElementById('routeAlertText');
    const topRisks = risks.slice(0, 3);
    const summary = topRisks.map(r => {
      const typeLabels = { sudden_brake: '🛑 Braking', blind_turn: '🔄 Blind turn', habitual_violation: '⚠️ Violation' };
      return `${typeLabels[r.type]} at ${r.roadName} (severity ${r.severity})`;
    }).join(' · ');
    alertText.textContent = summary;
    alertBox.classList.add('visible');
    alertBox.classList.remove('error');
  }
}
