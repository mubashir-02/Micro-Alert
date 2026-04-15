// ─── Micro-Alert Chat / LLM Controller ──────────────────────────────────────────
// Handles all LLM API interactions: explain risk, ask about area, condensed alert

// ─── Explain a specific risk ────────────────────────────────────────────────────
async function explainRisk(riskId) {
  const resultEl = document.getElementById(`explain-${riskId}`);
  if (!resultEl) return;

  // Toggle visibility if already showing
  if (resultEl.style.display === 'block') {
    resultEl.style.display = 'none';
    return;
  }

  // Find the risk data
  const risk = allRisks.find(r => r._id === riskId);
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
async function askAboutArea() {
  const loading = document.getElementById('askLoading');
  const resultBox = document.getElementById('askResult');
  const resultText = document.getElementById('askResultText');
  const btn = document.getElementById('askAreaBtn');

  // Show loading
  loading.classList.add('visible');
  resultBox.classList.remove('visible');
  btn.disabled = true;

  try {
    // Get user's actual location via browser geolocation
    const userLocation = await getUserLocation();

    // Place the pulsing blue location marker
    if (userLocationMarker) map.removeLayer(userLocationMarker);
    if (userAccuracyCircle) map.removeLayer(userAccuracyCircle);

    userAccuracyCircle = L.circle([userLocation.lat, userLocation.lng], {
      radius: userLocation.accuracy,
      color: '#3b82f6',
      fillColor: '#3b82f6',
      fillOpacity: 0.08,
      weight: 1,
      opacity: 0.3
    }).addTo(map);

    userLocationMarker = L.marker([userLocation.lat, userLocation.lng], {
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
         <p class="popup-desc" style="margin-bottom:4px;">Lat: ${userLocation.lat.toFixed(6)}, Lng: ${userLocation.lng.toFixed(6)}</p>
         <p class="popup-desc">Accuracy: ~${Math.round(userLocation.accuracy)}m</p>
       </div>`
    );

    // Fly the map to the user's location
    map.flyTo([userLocation.lat, userLocation.lng], 15, { duration: 1.5 });

    // Reverse geocode to get a friendly area name
    let areaName = 'your current area';
    try {
      const name = await reverseGeocode(userLocation.lat, userLocation.lng);
      if (name) areaName = name;
    } catch (e) { /* use default */ }

    showToast(`📍 Analyzing risks near ${areaName}…`, 'success');

    // Wait a moment for map to settle
    await new Promise(resolve => setTimeout(resolve, 800));

    // Fetch nearby risks from the user's actual location
    const nearbyRes = await fetch(`/api/risks/nearby?lat=${userLocation.lat}&lng=${userLocation.lng}&radius=3000`);
    const nearbyJson = await nearbyRes.json();

    if (!nearbyJson.success || !nearbyJson.data.features || nearbyJson.data.features.length === 0) {
      resultText.textContent = `No risk data available near ${areaName}. You're in a low-risk zone — stay alert and drive safely!`;
      resultBox.classList.add('visible');
      loading.classList.remove('visible');
      btn.disabled = false;
      return;
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
        question: `I am currently near ${areaName}. What are the main risk patterns around my location? What should I watch out for as a commuter?`
      })
    });

    const llmJson = await llmRes.json();
    if (llmJson.success) {
      resultText.textContent = llmJson.answer;
    } else {
      resultText.textContent = '⚠️ ' + (llmJson.error || 'AI service unavailable. Please check your API key configuration.');
    }

    resultBox.classList.add('visible');
  } catch (err) {
    if (err.message === 'GEOLOCATION_DENIED') {
      resultText.textContent = '📍 Location access denied. Please allow location permissions in your browser and try again.';
    } else if (err.message === 'GEOLOCATION_UNAVAILABLE') {
      resultText.textContent = '📍 Location unavailable. Please ensure GPS/location services are enabled on your device.';
    } else if (err.message === 'GEOLOCATION_TIMEOUT') {
      resultText.textContent = '📍 Location request timed out. Please try again.';
    } else {
      resultText.textContent = '⚠️ Could not analyze area. Please try again.';
    }
    resultBox.classList.add('visible');
  } finally {
    loading.classList.remove('visible');
    btn.disabled = false;
  }
}

// ─── Get User Location via Geolocation API ──────────────────────────────────────
function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('GEOLOCATION_UNAVAILABLE'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy
        });
      },
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            reject(new Error('GEOLOCATION_DENIED'));
            break;
          case error.POSITION_UNAVAILABLE:
            reject(new Error('GEOLOCATION_UNAVAILABLE'));
            break;
          case error.TIMEOUT:
            reject(new Error('GEOLOCATION_TIMEOUT'));
            break;
          default:
            reject(new Error('GEOLOCATION_UNAVAILABLE'));
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000
      }
    );
  });
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
