// ─── Accident Prediction Routes ─────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const { Accident, Risk } = require('../models');
const { Op } = require('sequelize');

// ─── Helper: Haversine distance in km ───────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── POST /api/prediction/risk-score ─ Calculate accident risk ─────────────────
router.post('/risk-score', async (req, res) => {
  try {
    const {
      lat, lng,
      speed = 0,
      speedLimit = 40,
      weather = 'clear',
      timeOfDay = 'afternoon',
      roadType = 'urban'
    } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({ success: false, error: 'lat and lng are required' });
    }

    const userLat = parseFloat(lat);
    const userLng = parseFloat(lng);

    // ─── Factor 1: Historical accident density (0-40 points) ────────────
    const buffer = 0.005; // ~550m
    const nearbyAccidents = await Risk.findAll({
      where: {
        type: 'accident',
        lat: { [Op.between]: [userLat - buffer, userLat + buffer] },
        lng: { [Op.between]: [userLng - buffer, userLng + buffer] }
      },
      raw: true
    });

    // Also check Accident table
    const historicalAccidents = await Accident.findAll({
      where: {
        lat: { [Op.between]: [userLat - buffer, userLat + buffer] },
        lng: { [Op.between]: [userLng - buffer, userLng + buffer] }
      },
      raw: true
    });

    const totalNearbyAccidents = nearbyAccidents.length + historicalAccidents.length;
    const accidentScore = Math.min(totalNearbyAccidents * 8, 40);

    // Account for severity of nearby accidents
    const avgSeverity = nearbyAccidents.length > 0
      ? nearbyAccidents.reduce((s, a) => s + a.severity, 0) / nearbyAccidents.length
      : 0;
    const severityBonus = avgSeverity * 2; // 0-10 bonus

    // ─── Factor 2: Speed analysis (0-25 points) ─────────────────────────
    const speedRatio = parseFloat(speed) / parseFloat(speedLimit);
    let speedScore = 0;
    if (speedRatio > 1.4) speedScore = 25;
    else if (speedRatio > 1.2) speedScore = 18;
    else if (speedRatio > 1.1) speedScore = 12;
    else if (speedRatio > 1.0) speedScore = 6;
    else speedScore = 0;

    // ─── Factor 3: Weather conditions (0-15 points) ─────────────────────
    const weatherScores = {
      clear: 0,
      rain: 12,
      fog: 15,
      storm: 15
    };
    const weatherScore = weatherScores[weather] || 0;

    // ─── Factor 4: Time of day (0-10 points) ────────────────────────────
    const timeScores = {
      morning_rush: 6,
      afternoon: 3,
      evening_rush: 7,
      night: 10
    };
    const timeScore = timeScores[timeOfDay] || 3;

    // ─── Factor 5: Road type (0-10 points) ──────────────────────────────
    const roadScores = {
      highway: 7,
      expressway: 8,
      urban: 5,
      rural: 6
    };
    const roadScore = roadScores[roadType] || 5;

    // ─── Total risk score (0-100) ───────────────────────────────────────
    const totalScore = Math.min(
      accidentScore + severityBonus + speedScore + weatherScore + timeScore + roadScore,
      100
    );

    // Determine risk level
    let riskLevel, riskColor, riskLabel;
    if (totalScore >= 60) {
      riskLevel = 'high';
      riskColor = '#ef4444';
      riskLabel = '🔴 High Risk';
    } else if (totalScore >= 30) {
      riskLevel = 'medium';
      riskColor = '#f59e0b';
      riskLabel = '🟡 Medium Risk';
    } else {
      riskLevel = 'low';
      riskColor = '#10b981';
      riskLabel = '🟢 Low Risk';
    }

    // Generate recommendations
    const recommendations = [];
    if (speedScore > 12) recommendations.push('Reduce speed immediately — exceeding limit significantly');
    if (weatherScore > 8) recommendations.push('Poor weather conditions — increase following distance');
    if (timeScore > 7) recommendations.push('Low visibility period — use headlights and stay alert');
    if (accidentScore > 20) recommendations.push('High accident-density area — exercise extreme caution');
    if (roadScore > 6) recommendations.push('High-speed road — maintain lane discipline');
    if (recommendations.length === 0) recommendations.push('Conditions are favorable — continue safe driving');

    res.json({
      success: true,
      data: {
        totalScore: Math.round(totalScore),
        riskLevel,
        riskColor,
        riskLabel,
        breakdown: {
          accidentHistory: Math.round(accidentScore + severityBonus),
          speedAnalysis: speedScore,
          weather: weatherScore,
          timeOfDay: timeScore,
          roadType: roadScore
        },
        nearbyAccidents: totalNearbyAccidents,
        recommendations
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/prediction/route-risk ─ Full route risk analysis ─────────────────
router.get('/route-risk', async (req, res) => {
  try {
    const { startLat, startLng, endLat, endLng, weather, timeOfDay } = req.query;

    if (!startLat || !startLng || !endLat || !endLng) {
      return res.status(400).json({ success: false, error: 'Start and end coordinates required' });
    }

    const sLat = parseFloat(startLat);
    const sLng = parseFloat(startLng);
    const eLat = parseFloat(endLat);
    const eLng = parseFloat(endLng);

    // Sample 10 points along the route
    const points = [];
    for (let i = 0; i <= 10; i++) {
      const f = i / 10;
      points.push({
        lat: sLat + f * (eLat - sLat),
        lng: sLng + f * (eLng - sLng)
      });
    }

    // Check accident density at each point
    let totalRiskScore = 0;
    const hotspots = [];

    for (const point of points) {
      const buffer = 0.005;
      const nearby = await Risk.count({
        where: {
          type: 'accident',
          lat: { [Op.between]: [point.lat - buffer, point.lat + buffer] },
          lng: { [Op.between]: [point.lng - buffer, point.lng + buffer] }
        }
      });

      const pointScore = nearby * 10;
      totalRiskScore += pointScore;

      if (nearby > 0) {
        hotspots.push({
          lat: point.lat,
          lng: point.lng,
          accidentCount: nearby,
          riskScore: pointScore
        });
      }
    }

    // Weather & time modifiers
    const weatherMod = { clear: 1.0, rain: 1.5, fog: 1.7, storm: 2.0 };
    const timeMod = { morning_rush: 1.2, afternoon: 1.0, evening_rush: 1.3, night: 1.5 };

    totalRiskScore *= (weatherMod[weather] || 1.0);
    totalRiskScore *= (timeMod[timeOfDay] || 1.0);

    const avgRiskScore = Math.min(totalRiskScore / points.length, 100);

    let riskLevel;
    if (avgRiskScore >= 50) riskLevel = 'high';
    else if (avgRiskScore >= 25) riskLevel = 'medium';
    else riskLevel = 'low';

    res.json({
      success: true,
      data: {
        overallRisk: Math.round(avgRiskScore),
        riskLevel,
        hotspots,
        totalPointsAnalyzed: points.length,
        modifiers: {
          weather: weather || 'clear',
          timeOfDay: timeOfDay || 'afternoon'
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
