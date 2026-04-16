// ─── Speed Rating Routes ────────────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const { SpeedLog } = require('../models');
const { fn, col, Op } = require('sequelize');

// ─── Helper: Calculate star rating based on speed vs limit ──────────────────────
function calculateRating(speed, limit) {
  if (!limit || limit <= 0) limit = 40;
  const ratio = speed / limit;
  if (ratio <= 1.0) return 5;       // Within limit
  if (ratio <= 1.1) return 4;       // Slightly over (<10%)
  if (ratio <= 1.2) return 3;       // Moderately over (10-20%)
  if (ratio <= 1.4) return 2;       // Significantly over (20-40%)
  return 1;                          // Dangerous (>40%)
}

// ─── POST /api/speed/log ─ Log a speed reading ─────────────────────────────────
router.post('/log', async (req, res) => {
  try {
    const { speed, speedLimit, lat, lng, userId, roadName } = req.body;

    if (speed === undefined || !lat || !lng) {
      return res.status(400).json({ success: false, error: 'speed, lat, lng are required' });
    }

    const limit = speedLimit || 40;
    const rating = calculateRating(parseFloat(speed), limit);

    const log = await SpeedLog.create({
      speed: parseFloat(speed),
      speedLimit: limit,
      rating,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      userId: userId || null,
      roadName: roadName || 'Unknown'
    });

    res.json({
      success: true,
      data: {
        ...log.toJSON(),
        _id: log.id
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/speed/rating ─ Get current session rating ────────────────────────
router.get('/rating', async (req, res) => {
  try {
    const { userId } = req.query;

    const where = {};
    if (userId) where.userId = userId;

    // Get last 50 logs for this user/session
    const logs = await SpeedLog.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 50,
      raw: true
    });

    if (logs.length === 0) {
      return res.json({
        success: true,
        data: {
          currentRating: 5,
          avgSpeed: 0,
          totalLogs: 0,
          ratingHistory: []
        }
      });
    }

    const avgRating = logs.reduce((sum, l) => sum + l.rating, 0) / logs.length;
    const avgSpeed = logs.reduce((sum, l) => sum + l.speed, 0) / logs.length;

    res.json({
      success: true,
      data: {
        currentRating: Math.round(avgRating * 10) / 10,
        avgSpeed: Math.round(avgSpeed * 10) / 10,
        totalLogs: logs.length,
        latestRating: logs[0].rating,
        ratingHistory: logs.slice(0, 10).map(l => ({
          rating: l.rating,
          speed: l.speed,
          limit: l.speedLimit,
          time: l.createdAt
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/speed/leaderboard ─ Top rated drivers ────────────────────────────
router.get('/leaderboard', async (req, res) => {
  try {
    const leaderboard = await SpeedLog.findAll({
      attributes: [
        'userId',
        [fn('AVG', col('rating')), 'avgRating'],
        [fn('COUNT', col('id')), 'totalLogs'],
        [fn('AVG', col('speed')), 'avgSpeed']
      ],
      where: { userId: { [Op.ne]: null } },
      group: ['userId'],
      order: [[fn('AVG', col('rating')), 'DESC']],
      limit: 20,
      raw: true
    });

    res.json({ success: true, data: leaderboard });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
