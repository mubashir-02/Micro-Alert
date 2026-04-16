// ─── Predictive Risk Overlay — Feature D Frontend ───────────────────────────────
// Adds a toggleable "Predictive Risk" heatmap layer to the existing Leaflet map.
// Does NOT modify existing markers, routes, or camera reports.

(function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────────────
  let predictionLayerGroup = null;
  let predictionVisible = false;
  let predictionHotspots = [];
  let peakBannerShownHour = -1;
  let routeSafetyBadge = null;

  // ─── Wait for map to be ready ───────────────────────────────────────────────
  function waitForMap(callback) {
    if (typeof map !== 'undefined' && map) {
      callback();
    } else {
      setTimeout(() => waitForMap(callback), 500);
    }
  }

  // ─── Initialize Prediction Overlay ──────────────────────────────────────────
  function initPredictionOverlay() {
    try {
      predictionLayerGroup = L.layerGroup();

      // Add toggle button to map controls
      addPredictionToggleButton();

      // Check for peak hour alert
      checkPeakHourAlert();

      // Fetch hotspots initially
      fetchPredictionHotspots();

      // Refresh hotspots every 5 minutes
      setInterval(fetchPredictionHotspots, 5 * 60 * 1000);

      console.log('✅ Prediction overlay initialized');
    } catch (err) {
      console.warn('Prediction overlay init failed (degrading gracefully):', err.message);
    }
  }

  // ─── Add Toggle Button to Map Controls ──────────────────────────────────────
  function addPredictionToggleButton() {
    const controls = document.querySelector('.map-controls');
    if (!controls) return;

    const btn = document.createElement('button');
    btn.className = 'map-control-btn';
    btn.id = 'predictionToggle';
    btn.innerHTML = '🔮<span class="tooltip">Predictive Risk Layer</span>';
    btn.onclick = togglePredictionLayer;
    // Insert after the heatmap toggle
    const heatmapBtn = document.getElementById('heatmapToggle');
    if (heatmapBtn && heatmapBtn.nextSibling) {
      controls.insertBefore(btn, heatmapBtn.nextSibling);
    } else {
      controls.appendChild(btn);
    }
  }

  // ─── Toggle Prediction Layer ────────────────────────────────────────────────
  function togglePredictionLayer() {
    const btn = document.getElementById('predictionToggle');
    if (!btn) return;

    if (predictionVisible) {
      map.removeLayer(predictionLayerGroup);
      btn.classList.remove('active');
      predictionVisible = false;
    } else {
      predictionLayerGroup.addTo(map);
      btn.classList.add('active');
      predictionVisible = true;
      // Refresh data when turned on
      fetchPredictionHotspots();
    }
  }

  // ─── Fetch Prediction Hotspots ──────────────────────────────────────────────
  async function fetchPredictionHotspots() {
    try {
      const res = await fetch('/api/prediction-engine/hotspots');
      const json = await res.json();

      if (json.success && json.data) {
        predictionHotspots = json.data;
        renderPredictionCircles();

        // Show peak hour alert if applicable
        if (json.timeWindow && json.timeWindow.isPeakHour) {
          showPeakHourBanner(json.data);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch prediction hotspots:', err.message);
      // Degrade gracefully — hide layer silently
    }
  }

  // ─── Render Prediction Circles on Map ───────────────────────────────────────
  function renderPredictionCircles() {
    if (!predictionLayerGroup) return;

    // Clear existing prediction markers
    predictionLayerGroup.clearLayers();

    predictionHotspots.forEach(hotspot => {
      const radius = 200 + (hotspot.score * 300); // 200-500m based on score
      const opacity = 0.2 + (hotspot.score * 0.5); // 0.2-0.7

      // Determine color based on score
      let fillColor;
      if (hotspot.score >= 0.8) fillColor = '#ef4444'; // CRITICAL — red
      else if (hotspot.score >= 0.6) fillColor = '#f97316'; // HIGH — orange
      else if (hotspot.score >= 0.3) fillColor = '#eab308'; // MODERATE — yellow
      else fillColor = '#10b981'; // LOW — green

      // Create circle
      const circle = L.circle([hotspot.lat, hotspot.lng], {
        radius: radius,
        color: fillColor,
        fillColor: fillColor,
        fillOpacity: opacity * 0.4,
        weight: 1.5,
        opacity: opacity,
        className: hotspot.score >= 0.8 ? 'prediction-circle-critical' : 'prediction-circle'
      });

      // Tooltip with prediction info
      const scorePercent = Math.round(hotspot.score * 100);
      const tooltipContent = `
        <div class="prediction-tooltip">
          <div class="pred-tooltip-header" style="color:${fillColor}">
            ${hotspot.level} RISK (${scorePercent}%)
          </div>
          <div class="pred-tooltip-body">
            📍 ${hotspot.roadName || 'Unknown area'}
            ${hotspot.landmark ? `<br>🏷️ ${hotspot.landmark}` : ''}
            <br>⚠️ ${hotspot.incidentCount} incident(s) nearby
            ${hotspot.hazardTypes && hotspot.hazardTypes.length > 0
              ? `<br>🔍 ${hotspot.hazardTypes.join(', ')}`
              : ''}
          </div>
        </div>`;

      circle.bindTooltip(tooltipContent, {
        className: 'prediction-tooltip-wrapper',
        permanent: false,
        direction: 'top',
        offset: [0, -10]
      });

      predictionLayerGroup.addLayer(circle);

      // Add inner pulsing circle for CRITICAL zones
      if (hotspot.score >= 0.8) {
        const pulseCircle = L.circleMarker([hotspot.lat, hotspot.lng], {
          radius: 12,
          color: '#ef4444',
          fillColor: '#ef4444',
          fillOpacity: 0.6,
          weight: 2,
          className: 'pulse-critical-marker'
        });
        predictionLayerGroup.addLayer(pulseCircle);
      }
    });
  }

  // ─── Peak Hour Alert Banner ─────────────────────────────────────────────────
  function checkPeakHourAlert() {
    const hour = new Date().getHours();
    const isPeakHour = (hour >= 6 && hour <= 9) || (hour >= 16 && hour <= 19);

    if (isPeakHour && peakBannerShownHour !== hour) {
      // Will be triggered when hotspots are fetched
    }
  }

  function showPeakHourBanner(hotspots) {
    const hour = new Date().getHours();

    // Don't show more than once per hour per session
    if (peakBannerShownHour === hour) return;
    peakBannerShownHour = hour;

    const highRiskCount = hotspots.filter(h => h.score >= 0.6).length;
    if (highRiskCount === 0) return;

    // Create banner
    let banner = document.getElementById('peakHourBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'peakHourBanner';
      banner.className = 'peak-hour-banner';
      document.body.appendChild(banner);
    }

    banner.innerHTML = `
      <div class="peak-banner-content">
        <span class="peak-banner-icon">⚠️</span>
        <span class="peak-banner-text">Peak hour active — ${highRiskCount} high-risk zone${highRiskCount > 1 ? 's' : ''} near your area</span>
        <button class="peak-banner-close" onclick="this.parentElement.parentElement.classList.remove('visible')">&times;</button>
      </div>
    `;
    banner.classList.add('visible');

    // Auto-dismiss after 8 seconds
    setTimeout(() => {
      banner.classList.remove('visible');
    }, 8000);

    // Swipe to dismiss on mobile
    let startX = 0;
    banner.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; });
    banner.addEventListener('touchmove', (e) => {
      const diffX = Math.abs(e.touches[0].clientX - startX);
      if (diffX > 80) banner.classList.remove('visible');
    });
  }

  // ─── Route Safety Score ─────────────────────────────────────────────────────
  // Hook into route scanning to add safety score
  async function fetchRouteSafetyScore(startLat, startLng, endLat, endLng) {
    try {
      const res = await fetch(`/api/prediction-engine/route-risk?startLat=${startLat}&startLng=${startLng}&endLat=${endLat}&endLng=${endLng}`);
      const json = await res.json();

      if (json.success && json.data) {
        displayRouteSafetyBadge(json.data);
        return json.data;
      }
    } catch (err) {
      console.warn('Route safety score fetch failed:', err.message);
    }
    return null;
  }

  function displayRouteSafetyBadge(data) {
    // Remove existing badge
    if (routeSafetyBadge) {
      routeSafetyBadge.remove();
    }

    const routeInfoCard = document.getElementById('routeInfoCard');
    if (!routeInfoCard) return;

    routeSafetyBadge = document.createElement('div');
    routeSafetyBadge.className = 'route-safety-badge';
    routeSafetyBadge.id = 'routeSafetyBadge';

    const scoreColor = data.routeSafetyScore >= 70 ? '#10b981'
      : data.routeSafetyScore >= 50 ? '#eab308'
      : '#ef4444';

    routeSafetyBadge.innerHTML = `
      <div class="safety-badge-score" style="color:${scoreColor}">
        <span class="safety-badge-icon">🛡️</span>
        Route Safety: <strong>${data.routeSafetyScore}/100</strong>
      </div>
      ${data.narrative ? `<div class="safety-badge-narrative">${data.narrative}</div>` : ''}
      ${data.suggestAlternative ? '<div class="safety-badge-warning">⚠️ Consider a safer alternative route</div>' : ''}
    `;

    routeInfoCard.appendChild(routeSafetyBadge);
    routeInfoCard.style.display = 'block';
  }

  // ─── Expose to global scope for integration ─────────────────────────────────
  window.MicroAlertPrediction = {
    toggle: togglePredictionLayer,
    fetchHotspots: fetchPredictionHotspots,
    getRouteSafety: fetchRouteSafetyScore,
    isVisible: () => predictionVisible
  };

  // ─── Initialize when DOM is ready ───────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waitForMap(initPredictionOverlay));
  } else {
    waitForMap(initPredictionOverlay);
  }

})();
