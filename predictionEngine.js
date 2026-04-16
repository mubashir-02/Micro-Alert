// ─── Predictive Congestion & Risk Overlap Engine ────────────────────────────────
// Feature D: Proactive accident prevention via time-aware risk scoring
// This module is fully independent — no modifications to existing files.

const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
let Risk, Accident;
try {
  const models = require('./models');
  Risk = models.Risk;
  Accident = models.Accident;
} catch (e) {
  console.warn('predictionEngine: Models not loaded —', e.message);
}

let axios;
try {
  axios = require('axios');
} catch (e) {
  // axios not installed — weather and LLM features will degrade
  axios = null;
}

// ─── In-Memory Prediction Cache (TTL = 5 minutes) ──────────────────────────────
const predictionCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(params) {
  return `${parseFloat(params.lat).toFixed(4)}_${parseFloat(params.lng).toFixed(4)}_${params.hour || ''}_${params.day_of_week || ''}`;
}

function getCached(key) {
  const entry = predictionCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    predictionCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  // Evict oldest entries if cache grows too large (max 500 entries)
  if (predictionCache.size > 500) {
    const firstKey = predictionCache.keys().next().value;
    predictionCache.delete(firstKey);
  }
  predictionCache.set(key, { ts: Date.now(), data });
}

// ─── Tunable Weights (can be exposed to admin panel) ────────────────────────────
const WEIGHTS = {
  W1: 0.30, // historical incident density
  W2: 0.25, // current traffic congestion level (0.0–1.0)
  W3: 0.20, // time-of-day risk multiplier
  W4: 0.10, // weather condition factor
  W5: 0.15  // recency of community reports (last 24h)
};

// ─── TimeOfDay Multiplier Table ─────────────────────────────────────────────────
function getTimeOfDayMultiplier(hour) {
  if (hour >= 0 && hour <= 5) return 0.6;   // low traffic, fatigue risk
  if (hour >= 6 && hour <= 9) return 1.4;   // morning peak
  if (hour >= 10 && hour <= 15) return 0.8;  // mid-day
  if (hour >= 16 && hour <= 19) return 1.5;  // evening peak — highest
  return 1.0;                                 // night baseline (20-23)
}

// ─── Risk Level Classification ──────────────────────────────────────────────────
function classifyRisk(score) {
  if (score >= 0.8) return { level: 'CRITICAL', color: '#ef4444', cssClass: 'critical' };
  if (score >= 0.6) return { level: 'HIGH', color: '#f97316', cssClass: 'high' };
  if (score >= 0.3) return { level: 'MODERATE', color: '#eab308', cssClass: 'moderate' };
  return { level: 'LOW', color: '#10b981', cssClass: 'low' };
}

// ─── Haversine Distance (km) ────────────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Fetch Weather Factor from OpenWeatherMap ───────────────────────────────────
async function getWeatherRiskFactor(lat, lng) {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) return 0.3; // Default moderate if no API key

    const res = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}`,
      { timeout: 3000 }
    );

    const weather = res.data;
    const mainWeather = weather.weather?.[0]?.main?.toLowerCase() || '';
    const visibility = weather.visibility || 10000;

    // Weather risk mapping
    let factor = 0.2; // clear baseline
    if (mainWeather.includes('rain') || mainWeather.includes('drizzle')) factor = 0.7;
    else if (mainWeather.includes('thunderstorm')) factor = 0.95;
    else if (mainWeather.includes('fog') || mainWeather.includes('mist') || mainWeather.includes('haze')) factor = 0.8;
    else if (mainWeather.includes('snow')) factor = 0.9;
    else if (mainWeather.includes('cloud')) factor = 0.3;

    // Visibility modifier
    if (visibility < 1000) factor = Math.max(factor, 0.85);
    else if (visibility < 5000) factor = Math.max(factor, 0.6);

    return Math.min(factor, 1.0);
  } catch (err) {
    return 0.3; // Default moderate on failure
  }
}

// ─── Core Prediction Score Algorithm ────────────────────────────────────────────
async function computeRiskScore(lat, lng, radiusMeters, hour, dayOfWeek) {
  const userLat = parseFloat(lat);
  const userLng = parseFloat(lng);
  const radiusKm = (radiusMeters || 500) / 1000;
  const currentHour = hour !== undefined ? parseInt(hour) : new Date().getHours();

  // Buffer for DB query (approximate bounding box)
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos(userLat * Math.PI / 180));

  // ─── Factor 1: Historical Incident Density (normalized 0-1) ───────
  let allNearbyRisks = [];
  try {
    allNearbyRisks = await Risk.findAll({
      where: {
        lat: { [Op.between]: [userLat - latDelta, userLat + latDelta] },
        lng: { [Op.between]: [userLng - lngDelta, userLng + lngDelta] }
      },
      raw: true
    });
  } catch (e) { /* DB unavailable — degrade gracefully */ }

  // Filter by actual distance
  const nearbyRisks = allNearbyRisks.filter(r =>
    haversine(userLat, userLng, r.lat, r.lng) <= radiusKm
  );

  // Also check Accident table
  let nearbyAccidents = [];
  try {
    const accidentResults = await Accident.findAll({
      where: {
        lat: { [Op.between]: [userLat - latDelta, userLat + latDelta] },
        lng: { [Op.between]: [userLng - lngDelta, userLng + lngDelta] }
      },
      raw: true
    });
    nearbyAccidents = accidentResults.filter(a =>
      haversine(userLat, userLng, a.lat, a.lng) <= radiusKm
    );
  } catch (e) { /* Accident table might not exist */ }

  const totalIncidents = nearbyRisks.length + nearbyAccidents.length;
  // Normalize: 10+ incidents in radius → 1.0
  const normalizedHistorical = Math.min(totalIncidents / 10, 1.0);

  // ─── Factor 2: Traffic Density Index ──────────────────────────────
  // Use time-of-day as proxy for traffic density (no external traffic API)
  const timeMultiplier = getTimeOfDayMultiplier(currentHour);
  const trafficDensityIndex = Math.min(timeMultiplier / 1.5, 1.0); // Normalize to 0-1

  // ─── Factor 3: Time of Day Multiplier ─────────────────────────────
  const normalizedTimeMultiplier = timeMultiplier / 1.5; // Normalize highest (1.5) to 1.0

  // ─── Factor 4: Weather Risk Factor ────────────────────────────────
  const weatherFactor = await getWeatherRiskFactor(userLat, userLng);

  // ─── Factor 5: Recent Reports (last 24 hours) ────────────────────
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentRisks = nearbyRisks.filter(r => {
    const created = new Date(r.createdAt);
    return created >= twentyFourHoursAgo;
  });
  // Normalize: 5+ recent reports → 1.0
  const recentReportCount = Math.min(recentRisks.length / 5, 1.0);

  // ─── Compute Final Score ──────────────────────────────────────────
  let rawScore =
    (WEIGHTS.W1 * normalizedHistorical) +
    (WEIGHTS.W2 * trafficDensityIndex) +
    (WEIGHTS.W3 * normalizedTimeMultiplier) +
    (WEIGHTS.W4 * weatherFactor) +
    (WEIGHTS.W5 * recentReportCount);

  // Clamp to 0.0 - 1.0
  const finalScore = Math.max(0, Math.min(rawScore, 1.0));
  const classification = classifyRisk(finalScore);

  // Determine dominant hazard types
  const hazardTypeCounts = {};
  nearbyRisks.forEach(r => {
    const t = r.type || 'unknown';
    hazardTypeCounts[t] = (hazardTypeCounts[t] || 0) + 1;
  });
  const hazardTypes = Object.entries(hazardTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([type]) => type.replace(/_/g, ' '));

  return {
    score: parseFloat(finalScore.toFixed(3)),
    level: classification.level,
    color: classification.color,
    cssClass: classification.cssClass,
    breakdown: {
      historicalIncidents: parseFloat(normalizedHistorical.toFixed(3)),
      trafficDensity: parseFloat(trafficDensityIndex.toFixed(3)),
      timeOfDay: parseFloat(normalizedTimeMultiplier.toFixed(3)),
      weatherRisk: parseFloat(weatherFactor.toFixed(3)),
      recentReports: parseFloat(recentReportCount.toFixed(3))
    },
    weights: WEIGHTS,
    metadata: {
      totalIncidents,
      recentReportsCount: recentRisks.length,
      hazardTypes,
      timeMultiplier,
      hour: currentHour,
      radiusMeters: radiusMeters || 500,
      lat: userLat,
      lng: userLng
    }
  };
}

// ─── Generate AI Narrative via LLM ──────────────────────────────────────────────
async function generatePredictionNarrative(scoreData, locationName) {
  try {
    const provider = process.env.LLM_PROVIDER || 'nvidia';
    const systemPrompt = "You are a road safety assistant. Given a risk score and location context, generate ONE plain English sentence (max 15 words) that tells a commuter what to watch out for. Be specific, not generic. Never say 'be careful'.";

    const timeLabel = scoreData.metadata.hour >= 6 && scoreData.metadata.hour <= 9 ? 'Morning peak'
      : scoreData.metadata.hour >= 16 && scoreData.metadata.hour <= 19 ? 'Evening peak'
      : scoreData.metadata.hour >= 20 || scoreData.metadata.hour < 6 ? 'Night' : 'Mid-day';

    const userPrompt = JSON.stringify({
      location: locationName || `${scoreData.metadata.lat.toFixed(4)}, ${scoreData.metadata.lng.toFixed(4)}`,
      score: scoreData.score,
      hazard_types: scoreData.metadata.hazardTypes,
      time: timeLabel
    });

    if (provider === 'nvidia') {
      const { default: OpenAI } = await import('openai');
      const openai = new OpenAI({
        apiKey: process.env.NVIDIA_API_KEY,
        baseURL: 'https://integrate.api.nvidia.com/v1',
      });
      const completion = await openai.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 50,
        temperature: 0.5,
        stream: false
      });
      return completion.choices[0]?.message?.content?.trim() || null;
    }

    // Groq fallback
    if (provider === 'groq' && process.env.GROQ_API_KEY) {
      const resp = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'mixtral-8x7b-32768',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 50,
          temperature: 0.5
        },
        { headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
      );
      return resp.data.choices[0].message.content.trim();
    }

    return null;
  } catch (err) {
    console.warn('Prediction narrative generation failed:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /api/prediction-engine/score ──────────────────────────────────────────
// Accepts { lat, lng, radius_meters, hour, day_of_week }
router.post('/score', async (req, res) => {
  try {
    const { lat, lng, radius_meters, hour, day_of_week } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({ success: false, error: 'lat and lng are required' });
    }

    // Check cache
    const cacheKey = getCacheKey({ lat, lng, hour, day_of_week });
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json({ success: true, data: cached, cached: true });
    }

    // Compute score
    const scoreData = await computeRiskScore(lat, lng, radius_meters, hour, day_of_week);

    // Generate AI narrative for moderate+ risk
    if (scoreData.score >= 0.3) {
      const narrative = await generatePredictionNarrative(scoreData);
      scoreData.narrative = narrative;
    }

    // Cache result
    setCache(cacheKey, scoreData);

    res.json({ success: true, data: scoreData, cached: false });
  } catch (err) {
    console.error('Prediction score error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/prediction-engine/hotspots ────────────────────────────────────────
// Returns top 10 predicted risk hotspots for current time window
router.get('/hotspots', async (req, res) => {
  try {
    const currentHour = new Date().getHours();
    const dayOfWeek = new Date().getDay();

    // Get all risk locations, group by proximity
    let allRisks = [];
    try {
      allRisks = await Risk.findAll({
        where: { cleared: false },
        order: [['severity', 'DESC']],
        raw: true,
        limit: 200
      });
    } catch (e) {
      return res.json({ success: true, data: [] });
    }

    // Cluster risks by proximity (0.005 degree ≈ 550m radius)
    const clusters = [];
    const used = new Set();

    for (let i = 0; i < allRisks.length; i++) {
      if (used.has(i)) continue;
      const cluster = { risks: [allRisks[i]], lat: allRisks[i].lat, lng: allRisks[i].lng };
      used.add(i);

      for (let j = i + 1; j < allRisks.length; j++) {
        if (used.has(j)) continue;
        if (haversine(cluster.lat, cluster.lng, allRisks[j].lat, allRisks[j].lng) <= 0.55) {
          cluster.risks.push(allRisks[j]);
          used.add(j);
        }
      }

      // Compute cluster center
      cluster.lat = cluster.risks.reduce((s, r) => s + r.lat, 0) / cluster.risks.length;
      cluster.lng = cluster.risks.reduce((s, r) => s + r.lng, 0) / cluster.risks.length;
      clusters.push(cluster);
    }

    // Score each cluster
    const scoredHotspots = [];
    for (const cluster of clusters.slice(0, 20)) {
      const cacheKey = getCacheKey({ lat: cluster.lat, lng: cluster.lng, hour: currentHour, day_of_week: dayOfWeek });
      let scoreData = getCached(cacheKey);

      if (!scoreData) {
        scoreData = await computeRiskScore(cluster.lat, cluster.lng, 500, currentHour, dayOfWeek);
        setCache(cacheKey, scoreData);
      }

      scoredHotspots.push({
        lat: cluster.lat,
        lng: cluster.lng,
        score: scoreData.score,
        level: scoreData.level,
        color: scoreData.color,
        incidentCount: cluster.risks.length,
        hazardTypes: scoreData.metadata.hazardTypes,
        roadName: cluster.risks[0]?.roadName || 'Unknown',
        landmark: cluster.risks[0]?.landmark || ''
      });
    }

    // Sort by score descending, take top 10
    scoredHotspots.sort((a, b) => b.score - a.score);
    const top10 = scoredHotspots.slice(0, 10);

    res.json({
      success: true,
      data: top10,
      timeWindow: {
        hour: currentHour,
        dayOfWeek,
        multiplier: getTimeOfDayMultiplier(currentHour),
        isPeakHour: (currentHour >= 6 && currentHour <= 9) || (currentHour >= 16 && currentHour <= 19)
      }
    });
  } catch (err) {
    console.error('Hotspots error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/prediction-engine/route-risk ──────────────────────────────────────
// Accepts route polyline as query params, returns per-segment risk scores
router.get('/route-risk', async (req, res) => {
  try {
    const { polyline, startLat, startLng, endLat, endLng } = req.query;

    let points = [];

    if (polyline) {
      // Parse polyline as comma-separated lat,lng pairs
      try {
        const parts = polyline.split(';');
        points = parts.map(p => {
          const [lat, lng] = p.split(',').map(Number);
          return { lat, lng };
        }).filter(p => !isNaN(p.lat) && !isNaN(p.lng));
      } catch (e) {
        return res.status(400).json({ success: false, error: 'Invalid polyline format. Use: lat1,lng1;lat2,lng2;...' });
      }
    } else if (startLat && startLng && endLat && endLng) {
      // Generate 10 sample points along the route
      const sLat = parseFloat(startLat);
      const sLng = parseFloat(startLng);
      const eLat = parseFloat(endLat);
      const eLng = parseFloat(endLng);

      for (let i = 0; i <= 10; i++) {
        const f = i / 10;
        points.push({
          lat: sLat + f * (eLat - sLat),
          lng: sLng + f * (eLng - sLng)
        });
      }
    } else {
      return res.status(400).json({ success: false, error: 'Provide polyline or startLat/startLng/endLat/endLng' });
    }

    const currentHour = new Date().getHours();
    const segments = [];
    let totalScore = 0;

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const cacheKey = getCacheKey({ lat: point.lat, lng: point.lng, hour: currentHour });
      let scoreData = getCached(cacheKey);

      if (!scoreData) {
        scoreData = await computeRiskScore(point.lat, point.lng, 300, currentHour);
        setCache(cacheKey, scoreData);
      }

      segments.push({
        index: i,
        lat: point.lat,
        lng: point.lng,
        score: scoreData.score,
        level: scoreData.level,
        color: scoreData.color,
        hazardTypes: scoreData.metadata.hazardTypes
      });

      totalScore += scoreData.score;
    }

    const avgScore = segments.length > 0 ? totalScore / segments.length : 0;
    // Route safety = inverse of risk (0-100)
    const routeSafetyScore = Math.round((1 - avgScore) * 100);
    const classification = classifyRisk(avgScore);

    // Identify high-risk segments
    const highRiskSegments = segments.filter(s => s.score >= 0.6);
    const criticalSegments = segments.filter(s => s.score >= 0.8);

    // Generate narrative for the overall route
    let routeNarrative = null;
    if (avgScore >= 0.3) {
      try {
        routeNarrative = await generatePredictionNarrative({
          score: avgScore,
          metadata: {
            hour: currentHour,
            lat: points[0].lat,
            lng: points[0].lng,
            hazardTypes: [...new Set(segments.flatMap(s => s.hazardTypes))].slice(0, 3)
          }
        }, 'your selected route');
      } catch (e) { /* silently skip narrative */ }
    }

    res.json({
      success: true,
      data: {
        routeSafetyScore,
        averageRiskScore: parseFloat(avgScore.toFixed(3)),
        riskLevel: classification.level,
        riskColor: classification.color,
        segments,
        highRiskSegments: highRiskSegments.length,
        criticalSegments: criticalSegments.length,
        suggestAlternative: routeSafetyScore < 50,
        narrative: routeNarrative,
        timeContext: {
          hour: currentHour,
          isPeakHour: (currentHour >= 6 && currentHour <= 9) || (currentHour >= 16 && currentHour <= 19),
          multiplier: getTimeOfDayMultiplier(currentHour)
        }
      }
    });
  } catch (err) {
    console.error('Route risk error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/prediction-engine/weights ─────────────────────────────────────────
// Admin endpoint to view current weights
router.get('/weights', (req, res) => {
  res.json({ success: true, data: WEIGHTS });
});

module.exports = router;
module.exports.computeRiskScore = computeRiskScore;
module.exports.getTimeOfDayMultiplier = getTimeOfDayMultiplier;
module.exports.classifyRisk = classifyRisk;
