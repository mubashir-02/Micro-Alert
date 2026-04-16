// ─── Offline Risk Map API — Feature F Backend ───────────────────────────────────
// Provides downloadable risk map snapshots for offline use.
// Endpoints are purely additive — no existing files are modified.

const express = require('express');
const router = express.Router();
const { Risk, Hazard, sequelize } = require('../models');
const { Op, fn, col, literal } = require('sequelize');

// ─── GET /api/offline/risk-map ──────────────────────────────────────────────────
// Downloads a compact risk map snapshot for a given area.
// Query: lat, lng, radiusKm (default 5), includeCleared (default false)
router.get('/risk-map', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radiusKm = parseFloat(req.query.radiusKm) || 5;
    const includeCleared = req.query.includeCleared === 'true';

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({
        success: false,
        error: 'lat and lng are required query parameters'
      });
    }

    // Compute bounding box
    const latDelta = radiusKm / 111;
    const lngDelta = radiusKm / (111 * Math.cos(lat * Math.PI / 180));

    const where = {
      lat: { [Op.between]: [lat - latDelta, lat + latDelta] },
      lng: { [Op.between]: [lng - lngDelta, lng + lngDelta] }
    };

    if (!includeCleared) {
      where.cleared = { [Op.ne]: true };
    }

    // Fetch risks
    const risks = await Risk.findAll({
      where,
      attributes: ['id', 'lat', 'lng', 'type', 'severity', 'description',
                    'roadName', 'landmark', 'timeOfDay', 'cleared', 'createdAt'],
      order: [['severity', 'DESC']],
      limit: 500,
      raw: true
    });

    // Fetch hazards in the same area
    let hazards = [];
    try {
      hazards = await Hazard.findAll({
        where: {
          lat: { [Op.between]: [lat - latDelta, lat + latDelta] },
          lng: { [Op.between]: [lng - lngDelta, lng + lngDelta] },
          active: true
        },
        attributes: ['id', 'lat', 'lng', 'type', 'severity', 'description'],
        limit: 200,
        raw: true
      });
    } catch (e) { /* Hazard table might not exist */ }

    // Compute area statistics
    const totalRisks = risks.length;
    const criticalCount = risks.filter(r => r.severity >= 4).length;
    const typeBreakdown = {};
    risks.forEach(r => {
      const t = r.type || 'unknown';
      typeBreakdown[t] = (typeBreakdown[t] || 0) + 1;
    });

    // Compute time-of-day risk distribution
    const timeDistribution = {};
    risks.forEach(r => {
      const tod = r.timeOfDay || 'unknown';
      timeDistribution[tod] = (timeDistribution[tod] || 0) + 1;
    });

    // Build compact offline payload
    const riskMap = {
      version: 1,
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      center: { lat, lng },
      radiusKm,
      stats: {
        totalRisks,
        totalHazards: hazards.length,
        criticalCount,
        typeBreakdown,
        timeDistribution
      },
      risks: risks.map(r => ({
        id: r.id,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lng),
        type: r.type,
        severity: r.severity,
        desc: r.description || '',
        road: r.roadName || '',
        landmark: r.landmark || '',
        tod: r.timeOfDay || '',
        ts: r.createdAt
      })),
      hazards: hazards.map(h => ({
        id: h.id,
        lat: parseFloat(h.lat),
        lng: parseFloat(h.lng),
        type: h.type,
        severity: h.severity,
        desc: h.description || ''
      })),
      // High-risk zones (clusters of severity >= 4)
      hotZones: computeHotZones(risks.filter(r => r.severity >= 3))
    };

    // Set cache headers for offline use
    res.set({
      'Cache-Control': 'public, max-age=3600',
      'X-Risk-Map-Version': '1',
      'X-Risk-Map-Expires': riskMap.expiresAt
    });

    res.json({ success: true, data: riskMap });
  } catch (err) {
    console.error('Risk map download error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/offline/route-snapshot ────────────────────────────────────────────
// Downloads risk data along a specific route for offline use.
// Query: startLat, startLng, endLat, endLng, bufferMeters (default 200)
router.get('/route-snapshot', async (req, res) => {
  try {
    const sLat = parseFloat(req.query.startLat);
    const sLng = parseFloat(req.query.startLng);
    const eLat = parseFloat(req.query.endLat);
    const eLng = parseFloat(req.query.endLng);
    const bufferKm = (parseInt(req.query.bufferMeters) || 200) / 1000;

    if ([sLat, sLng, eLat, eLng].some(isNaN)) {
      return res.status(400).json({
        success: false,
        error: 'startLat, startLng, endLat, endLng are required'
      });
    }

    // Bounding box covering the route + buffer
    const minLat = Math.min(sLat, eLat) - bufferKm / 111;
    const maxLat = Math.max(sLat, eLat) + bufferKm / 111;
    const avgLat = (sLat + eLat) / 2;
    const minLng = Math.min(sLng, eLng) - bufferKm / (111 * Math.cos(avgLat * Math.PI / 180));
    const maxLng = Math.max(sLng, eLng) + bufferKm / (111 * Math.cos(avgLat * Math.PI / 180));

    const risks = await Risk.findAll({
      where: {
        lat: { [Op.between]: [minLat, maxLat] },
        lng: { [Op.between]: [minLng, maxLng] },
        cleared: { [Op.ne]: true }
      },
      attributes: ['id', 'lat', 'lng', 'type', 'severity', 'description',
                    'roadName', 'landmark', 'timeOfDay', 'createdAt'],
      order: [['severity', 'DESC']],
      limit: 300,
      raw: true
    });

    // Generate 10 waypoints along the route for segment scoring
    const waypoints = [];
    for (let i = 0; i <= 10; i++) {
      const f = i / 10;
      waypoints.push({
        lat: sLat + f * (eLat - sLat),
        lng: sLng + f * (eLng - sLng),
        nearbyRisks: 0,
        maxSeverity: 0
      });
    }

    // Count risks near each waypoint
    risks.forEach(r => {
      waypoints.forEach(wp => {
        const dist = haversine(wp.lat, wp.lng, r.lat, r.lng);
        if (dist <= bufferKm) {
          wp.nearbyRisks++;
          wp.maxSeverity = Math.max(wp.maxSeverity, r.severity);
        }
      });
    });

    const snapshot = {
      version: 1,
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      route: {
        start: { lat: sLat, lng: sLng },
        end: { lat: eLat, lng: eLng },
        bufferMeters: bufferKm * 1000
      },
      stats: {
        totalRisks: risks.length,
        criticalCount: risks.filter(r => r.severity >= 4).length,
        highRiskSegments: waypoints.filter(wp => wp.maxSeverity >= 4).length
      },
      risks: risks.map(r => ({
        id: r.id,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lng),
        type: r.type,
        severity: r.severity,
        desc: r.description || '',
        road: r.roadName || '',
        landmark: r.landmark || ''
      })),
      waypoints
    };

    res.set({ 'Cache-Control': 'public, max-age=3600' });
    res.json({ success: true, data: snapshot });
  } catch (err) {
    console.error('Route snapshot error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/offline/sync-status ───────────────────────────────────────────────
// Returns server timestamp for sync validation
router.get('/sync-status', (req, res) => {
  res.json({
    success: true,
    data: {
      serverTime: new Date().toISOString(),
      cacheVersion: 'v1',
      recommendedTTL: 24 * 60 * 60 * 1000 // 24 hours in ms
    }
  });
});

// ─── POST /api/offline/sync-reports ─────────────────────────────────────────────
// Receives batched offline reports for processing
router.post('/sync-reports', async (req, res) => {
  try {
    const { reports } = req.body;

    if (!reports || !Array.isArray(reports)) {
      return res.status(400).json({
        success: false,
        error: 'reports array is required'
      });
    }

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const report of reports) {
      try {
        const risk = await Risk.create({
          lat: parseFloat(report.lat),
          lng: parseFloat(report.lng),
          type: report.type || 'unknown',
          severity: parseInt(report.severity) || 3,
          description: report.description || 'Reported offline',
          roadName: report.roadName || '',
          landmark: report.landmark || '',
          timeOfDay: report.timeOfDay || getTimeOfDay(),
          cleared: false,
          verified: false
        });

        // Broadcast via socket
        const io = req.app.get('io');
        if (io) {
          io.emit('hazard-changed', {
            action: 'added',
            risk: { ...risk.toJSON(), _id: risk.id, offlineSync: true }
          });
        }

        results.push({ clientId: report.clientId, serverId: risk.id, status: 'created' });
        successCount++;
      } catch (err) {
        results.push({ clientId: report.clientId, status: 'failed', error: err.message });
        failCount++;
      }
    }

    res.json({
      success: true,
      data: {
        processed: reports.length,
        created: successCount,
        failed: failCount,
        results
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Helper: Compute Hot Zones ──────────────────────────────────────────────────
function computeHotZones(risks) {
  if (risks.length === 0) return [];

  const clusters = [];
  const used = new Set();

  for (let i = 0; i < risks.length; i++) {
    if (used.has(i)) continue;
    const cluster = { risks: [risks[i]], lat: parseFloat(risks[i].lat), lng: parseFloat(risks[i].lng) };
    used.add(i);

    for (let j = i + 1; j < risks.length; j++) {
      if (used.has(j)) continue;
      if (haversine(cluster.lat, cluster.lng, parseFloat(risks[j].lat), parseFloat(risks[j].lng)) <= 0.5) {
        cluster.risks.push(risks[j]);
        used.add(j);
      }
    }

    if (cluster.risks.length >= 2) {
      cluster.lat = cluster.risks.reduce((s, r) => s + parseFloat(r.lat), 0) / cluster.risks.length;
      cluster.lng = cluster.risks.reduce((s, r) => s + parseFloat(r.lng), 0) / cluster.risks.length;
      const maxSev = Math.max(...cluster.risks.map(r => r.severity));
      clusters.push({
        lat: cluster.lat,
        lng: cluster.lng,
        count: cluster.risks.length,
        maxSeverity: maxSev,
        level: maxSev >= 4 ? 'CRITICAL' : 'HIGH',
        radiusMeters: 300
      });
    }
  }

  return clusters.sort((a, b) => b.count - a.count).slice(0, 15);
}

// ─── Helper: Haversine Distance (km) ────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Helper: Get time of day ────────────────────────────────────────────────────
function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour >= 6 && hour <= 9) return 'morning_rush';
  if (hour >= 10 && hour <= 15) return 'afternoon';
  if (hour >= 16 && hour <= 19) return 'evening_rush';
  return 'night';
}

module.exports = router;
