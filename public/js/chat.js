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

  const center = map.getCenter();
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
      resultText.textContent = llmJson.answer;
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
