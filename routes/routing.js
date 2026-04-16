// ─── Routing Algorithm Routes ───────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const { Risk, Hazard } = require('../models');
const { Op } = require('sequelize');
const axios = require('axios');

// ─── Helper: Haversine distance ─────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Helper: Calculate hazard score for a route ─────────────────────────────────
async function calculateHazardScore(routeCoords) {
  const hazards = await Hazard.findAll({
    where: { active: true },
    raw: true
  });

  const risks = await Risk.findAll({
    where: { cleared: { [Op.ne]: true } },
    raw: true
  });

  let score = 0;
  let hazardCount = 0;

  // Check each point along the route for nearby hazards
  for (let i = 0; i < routeCoords.length; i += Math.max(1, Math.floor(routeCoords.length / 20))) {
    const [lat, lng] = routeCoords[i];

    // Check hazards
    for (const h of hazards) {
      const dist = haversine(lat, lng, h.lat, h.lng);
      if (dist < 0.5) { // 500m
        score += h.severity * 3;
        hazardCount++;
      }
    }

    // Check risks
    for (const r of risks) {
      const dist = haversine(lat, lng, r.lat, r.lng);
      if (dist < 0.5) {
        score += r.severity * 2;
        hazardCount++;
      }
    }
  }

  return { score, hazardCount };
}

// ─── POST /api/routing/find-routes ─ Find best routes ──────────────────────────
router.post('/find-routes', async (req, res) => {
  try {
    const { startLat, startLng, endLat, endLng } = req.body;

    if (!startLat || !startLng || !endLat || !endLng) {
      return res.status(400).json({ success: false, error: 'Start and end coordinates required' });
    }

    const sLat = parseFloat(startLat);
    const sLng = parseFloat(startLng);
    const eLat = parseFloat(endLat);
    const eLng = parseFloat(endLng);

    // Try OSRM for up to 3 alternative routes
    let routes = [];
    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${sLng},${sLat};${eLng},${eLat}?overview=full&geometries=geojson&alternatives=3&steps=true`;
      const osrmRes = await axios.get(osrmUrl, { timeout: 10000 });

      if (osrmRes.data && osrmRes.data.routes) {
        for (let i = 0; i < osrmRes.data.routes.length; i++) {
          const route = osrmRes.data.routes[i];
          const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
          const { score, hazardCount } = await calculateHazardScore(coords);

          routes.push({
            id: i + 1,
            name: i === 0 ? 'Fastest Route' : `Alternative ${i}`,
            distance: (route.distance / 1000).toFixed(1),
            duration: Math.round(route.duration / 60),
            hazardScore: score,
            hazardCount,
            coordinates: coords,
            color: i === 0 ? '#2563EB' : i === 1 ? '#F59E0B' : '#10b981'
          });
        }
      }
    } catch (osrmErr) {
      console.warn('OSRM failed, generating approximate routes:', osrmErr.message);
    }

    // Fallback: generate synthetic routes if OSRM didn't return enough
    if (routes.length < 3) {
      const straightDist = haversine(sLat, sLng, eLat, eLng);

      const generateRoute = (index, jitterMag) => {
        const coords = [];
        const steps = 25;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const lat = sLat + t * (eLat - sLat);
          const lng = sLng + t * (eLng - sLng);
          const jitter = Math.sin(t * Math.PI * (2 + index)) * jitterMag;
          coords.push([lat + jitter, lng + jitter * 0.7]);
        }
        return coords;
      };

      const routeNames = ['Direct Route', 'Northern Bypass', 'Southern Detour'];
      const routeColors = ['#2563EB', '#F59E0B', '#10b981'];
      const distMultipliers = [1.0, 1.15, 1.25];

      for (let i = routes.length; i < 3; i++) {
        const coords = generateRoute(i, 0.003 * (i + 1));
        const { score, hazardCount } = await calculateHazardScore(coords);
        routes.push({
          id: i + 1,
          name: routeNames[i] || `Route ${i + 1}`,
          distance: (straightDist * distMultipliers[i]).toFixed(1),
          duration: Math.round((straightDist * distMultipliers[i]) / 0.5), // Assuming 30 km/h avg
          hazardScore: score,
          hazardCount,
          coordinates: coords,
          color: routeColors[i]
        });
      }
    }

    // Sort routes: safest first (lowest hazard score), then shortest
    routes.sort((a, b) => {
      const safetyDiff = a.hazardScore - b.hazardScore;
      if (Math.abs(safetyDiff) > 10) return safetyDiff;
      return parseFloat(a.distance) - parseFloat(b.distance);
    });

    // Assign rank labels
    routes[0].name = '🛡️ Safest Route';
    if (routes[1]) routes[1].name = '⚡ Balanced Route';
    if (routes[2]) routes[2].name = '📏 Shortest Route';

    res.json({
      success: true,
      data: {
        routes: routes.slice(0, 3),
        start: { lat: sLat, lng: sLng },
        end: { lat: eLat, lng: eLng }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
