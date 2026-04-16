const express = require('express');
const router = express.Router();
const { Risk, EmergencyDispatch, SpeedLog, Hazard, User, Accident, sequelize } = require('../models');
const { Op, fn, col, literal } = require('sequelize');

// ─── GET /admin ─ Admin Dashboard Page ──────────────────────────────────────────
router.get('/', (req, res) => {
  res.render('admin', {
    title: 'MicroAlert · Admin Control Center'
  });
});

// ─── GET /admin/api/stats ─ Dashboard Statistics ────────────────────────────────
router.get('/api/stats', async (req, res) => {
  try {
    const totalRisks = await Risk.count();
    const clearedRisks = await Risk.count({ where: { cleared: true } });
    const activeRisks = await Risk.count({ where: { cleared: { [Op.ne]: true } } });
    const verifiedRisks = await Risk.count({ where: { verified: true } });
    const unverifiedRisks = await Risk.count({ where: { verified: false } });

    // Count by type
    const typeCountsRaw = await Risk.findAll({
      attributes: [
        'type',
        [fn('COUNT', col('id')), 'count'],
        [fn('SUM', literal('CASE WHEN cleared = true THEN 1 ELSE 0 END')), 'cleared']
      ],
      group: ['type'],
      raw: true
    });
    const typeCounts = typeCountsRaw.map(tc => ({
      _id: tc.type,
      count: parseInt(tc.count),
      cleared: parseInt(tc.cleared) || 0
    }));

    // Count by severity
    const severityCountsRaw = await Risk.findAll({
      attributes: [
        'severity',
        [fn('COUNT', col('id')), 'count'],
        [fn('SUM', literal('CASE WHEN cleared = true THEN 1 ELSE 0 END')), 'cleared']
      ],
      group: ['severity'],
      order: [['severity', 'ASC']],
      raw: true
    });
    const severityCounts = severityCountsRaw.map(sc => ({
      _id: parseInt(sc.severity),
      count: parseInt(sc.count),
      cleared: parseInt(sc.cleared) || 0
    }));

    // Count by time of day
    const timeCountsRaw = await Risk.findAll({
      attributes: [
        'timeOfDay',
        [fn('COUNT', col('id')), 'count']
      ],
      group: ['timeOfDay'],
      raw: true
    });
    const timeCounts = timeCountsRaw.map(tc => ({
      _id: tc.timeOfDay,
      count: parseInt(tc.count)
    }));

    // Recently cleared
    const recentlyCleared = await Risk.findAll({
      where: { cleared: true },
      order: [['clearedAt', 'DESC']],
      limit: 20,
      raw: true
    });

    // Emergency dispatch stats
    const totalDispatches = await EmergencyDispatch.count();
    const pendingDispatches = await EmergencyDispatch.count({ where: { status: 'pending' } });
    const activeDispatches = await EmergencyDispatch.count({
      where: { status: { [Op.in]: ['pending', 'dispatched', 'en_route'] } }
    });

    res.json({
      success: true,
      data: {
        totalRisks,
        clearedRisks,
        activeRisks,
        verifiedRisks,
        unverifiedRisks,
        typeCounts,
        severityCounts,
        timeCounts,
        recentlyCleared: recentlyCleared.map(r => ({ ...r, _id: r.id })),
        clearanceRate: totalRisks > 0 ? ((clearedRisks / totalRisks) * 100).toFixed(1) : 0,
        totalDispatches,
        pendingDispatches,
        activeDispatches
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /admin/api/risks ─ All Risks for Admin Table ───────────────────────────
router.get('/api/risks', async (req, res) => {
  try {
    const { type, severity, status, search } = req.query;
    const where = {};

    if (type && type !== 'all') where.type = type;
    if (severity && severity !== 'all') where.severity = parseInt(severity);
    if (status === 'active') where.cleared = { [Op.ne]: true };
    if (status === 'cleared') where.cleared = true;
    if (search) {
      where[Op.or] = [
        { roadName: { [Op.like]: `%${search}%` } },
        { landmark: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } }
      ];
    }

    const risks = await Risk.findAll({
      where,
      order: [['severity', 'DESC'], ['createdAt', 'DESC']],
      raw: true
    });

    res.json({ success: true, data: risks.map(r => ({ ...r, _id: r.id })) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PUT /admin/api/risks/:id/clear ─ Clear a Single Risk ──────────────────────
router.put('/api/risks/:id/clear', async (req, res) => {
  try {
    const [updated] = await Risk.update(
      { cleared: true, clearedAt: new Date() },
      { where: { id: req.params.id } }
    );
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Risk not found' });
    }
    const risk = await Risk.findByPk(req.params.id, { raw: true });
    const io = req.app.get('io');
    if (io) io.emit('hazard-changed', { action: 'cleared', risk: { ...risk, _id: risk.id } });
    res.json({ success: true, data: { ...risk, _id: risk.id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PUT /admin/api/risks/:id/unclear ─ Reactivate a Cleared Risk ──────────────
router.put('/api/risks/:id/unclear', async (req, res) => {
  try {
    const [updated] = await Risk.update(
      { cleared: false, clearedAt: null },
      { where: { id: req.params.id } }
    );
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Risk not found' });
    }
    const risk = await Risk.findByPk(req.params.id, { raw: true });
    res.json({ success: true, data: { ...risk, _id: risk.id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PUT /admin/api/risks/clear-bulk ─ Clear Multiple Risks ─────────────────────
router.put('/api/risks/clear-bulk', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'ids array is required' });
    }

    const [modifiedCount] = await Risk.update(
      { cleared: true, clearedAt: new Date() },
      { where: { id: { [Op.in]: ids } } }
    );

    res.json({ success: true, modified: modifiedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PUT /admin/api/risks/clear-by-type ─ Clear All Risks of a Type ────────────
router.put('/api/risks/clear-by-type', async (req, res) => {
  try {
    const { type } = req.body;
    if (!type) {
      return res.status(400).json({ success: false, error: 'type is required' });
    }

    const [modifiedCount] = await Risk.update(
      { cleared: true, clearedAt: new Date() },
      { where: { type, cleared: { [Op.ne]: true } } }
    );

    res.json({ success: true, modified: modifiedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── DELETE /admin/api/risks/:id ─ Permanently Delete a Risk ────────────────────
router.delete('/api/risks/:id', async (req, res) => {
  try {
    const deleted = await Risk.destroy({ where: { id: req.params.id } });
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Risk not found' });
    }
    res.json({ success: true, message: 'Risk deleted permanently' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /admin/api/dispatches ─ All Emergency Dispatches ───────────────────────
router.get('/api/dispatches', async (req, res) => {
  try {
    const dispatches = await EmergencyDispatch.findAll({
      order: [['createdAt', 'DESC']],
      limit: 50,
      raw: true
    });
    res.json({ success: true, data: dispatches.map(d => ({ ...d, _id: d.id })) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PUT /admin/api/dispatches/:id/status ─ Update Dispatch Status ──────────────
router.put('/api/dispatches/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const updateData = { status };
    if (status === 'resolved') updateData.resolvedAt = new Date();

    const [updated] = await EmergencyDispatch.update(updateData, {
      where: { id: req.params.id }
    });

    if (!updated) {
      return res.status(404).json({ success: false, error: 'Dispatch not found' });
    }

    const dispatch = await EmergencyDispatch.findByPk(req.params.id, { raw: true });
    const io = req.app.get('io');
    if (io) io.emit('dispatch-update', { ...dispatch, _id: dispatch.id });

    res.json({ success: true, data: { ...dispatch, _id: dispatch.id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /admin/api/speed-leaderboard ─ Driver Speed Ratings ────────────────────
router.get('/api/speed-leaderboard', async (req, res) => {
  try {
    const leaderboard = await SpeedLog.findAll({
      attributes: [
        'userId',
        [fn('AVG', col('rating')), 'avgRating'],
        [fn('COUNT', col('id')), 'totalLogs'],
        [fn('AVG', col('speed')), 'avgSpeed']
      ],
      group: ['userId'],
      order: [[literal('avgRating'), 'DESC']],
      limit: 20,
      raw: true
    });
    res.json({ success: true, data: leaderboard });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Hazard Management ──────────────────────────────────────────────────────────
router.post('/api/hazards', async (req, res) => {
  try {
    const { lat, lng, type, severity, description } = req.body;
    const hazard = await Hazard.create({
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      type,
      severity: parseInt(severity) || 3,
      description: description || ''
    });
    const io = req.app.get('io');
    if (io) io.emit('hazard-changed', { action: 'added', hazard });
    res.json({ success: true, data: hazard });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/api/hazards/:id', async (req, res) => {
  try {
    const { type, severity, description, active } = req.body;
    await Hazard.update(
      { type, severity, description, active },
      { where: { id: req.params.id } }
    );
    const hazard = await Hazard.findByPk(req.params.id, { raw: true });
    res.json({ success: true, data: hazard });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/api/hazards/:id', async (req, res) => {
  try {
    await Hazard.destroy({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Hazard deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CHALLENGE & TASK MANAGEMENT (Feature E — Admin Interface)
// ═══════════════════════════════════════════════════════════════════════════════

// In-memory challenge store (shared with gamification module via app.locals)
function getChallengeStore(req) {
  if (!req.app.locals.adminChallenges) {
    req.app.locals.adminChallenges = [];
  }
  return req.app.locals.adminChallenges;
}

// ─── GET /admin/api/challenges ─ List all challenges ────────────────────────────
router.get('/api/challenges', (req, res) => {
  try {
    const challenges = getChallengeStore(req);
    // Also load auto-generated challenges from gamification module
    let gameChallenges = [];
    try {
      const gamification = require('../gamification');
      if (gamification.getActiveChallenges) {
        gameChallenges = gamification.getActiveChallenges();
      }
    } catch (e) { /* module may not expose this */ }

    const all = [
      ...challenges.map(c => ({ ...c, source: 'admin' })),
      ...gameChallenges.map(c => ({ ...c, source: 'auto' }))
    ];

    res.json({ success: true, data: all });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /admin/api/challenges ─ Create a new challenge ────────────────────────
router.post('/api/challenges', (req, res) => {
  try {
    const { name, description, target, metric, reward, rewardBadge, durationDays, active } = req.body;

    if (!name || !description) {
      return res.status(400).json({ success: false, error: 'name and description are required' });
    }

    const challenges = getChallengeStore(req);
    const newChallenge = {
      id: `admin_challenge_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name,
      description,
      target: parseInt(target) || 5,
      metric: metric || 'reports',
      reward: parseInt(reward) || 100,
      rewardBadge: rewardBadge || null,
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + (parseInt(durationDays) || 7) * 24 * 60 * 60 * 1000).toISOString(),
      active: active !== false,
      participants: [],
      createdBy: 'admin',
      createdAt: new Date().toISOString()
    };

    challenges.push(newChallenge);

    // Push to gamification module's active challenges
    try {
      const gamification = require('../gamification');
      if (gamification.addAdminChallenge) {
        gamification.addAdminChallenge(newChallenge);
      }
    } catch (e) { /* silent */ }

    res.json({ success: true, data: newChallenge });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PUT /admin/api/challenges/:id ─ Update a challenge ─────────────────────────
router.put('/api/challenges/:id', (req, res) => {
  try {
    const { id } = req.params;
    const challenges = getChallengeStore(req);
    const idx = challenges.findIndex(c => c.id === id);

    if (idx === -1) {
      return res.status(404).json({ success: false, error: 'Challenge not found' });
    }

    const { name, description, target, metric, reward, active, durationDays } = req.body;

    if (name) challenges[idx].name = name;
    if (description) challenges[idx].description = description;
    if (target) challenges[idx].target = parseInt(target);
    if (metric) challenges[idx].metric = metric;
    if (reward) challenges[idx].reward = parseInt(reward);
    if (active !== undefined) challenges[idx].active = active;
    if (durationDays) {
      challenges[idx].endDate = new Date(
        new Date(challenges[idx].startDate).getTime() + parseInt(durationDays) * 24 * 60 * 60 * 1000
      ).toISOString();
    }
    challenges[idx].updatedAt = new Date().toISOString();

    res.json({ success: true, data: challenges[idx] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── DELETE /admin/api/challenges/:id ─ Delete a challenge ──────────────────────
router.delete('/api/challenges/:id', (req, res) => {
  try {
    const { id } = req.params;
    const challenges = getChallengeStore(req);
    const idx = challenges.findIndex(c => c.id === id);

    if (idx === -1) {
      return res.status(404).json({ success: false, error: 'Challenge not found' });
    }

    challenges.splice(idx, 1);

    // Remove from gamification module too
    try {
      const gamification = require('../gamification');
      if (gamification.removeAdminChallenge) {
        gamification.removeAdminChallenge(id);
      }
    } catch (e) { /* silent */ }

    res.json({ success: true, message: 'Challenge deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PUT /admin/api/challenges/:id/toggle ─ Toggle active status ────────────────
router.put('/api/challenges/:id/toggle', (req, res) => {
  try {
    const { id } = req.params;
    const challenges = getChallengeStore(req);
    const challenge = challenges.find(c => c.id === id);

    if (!challenge) {
      return res.status(404).json({ success: false, error: 'Challenge not found' });
    }

    challenge.active = !challenge.active;
    challenge.updatedAt = new Date().toISOString();

    res.json({ success: true, data: challenge });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /admin/api/game-stats ─ Gamification overview stats ────────────────────
router.get('/api/game-stats', (req, res) => {
  try {
    const challenges = getChallengeStore(req);
    const activeChallenges = challenges.filter(c => c.active);
    const totalParticipants = activeChallenges.reduce((sum, c) => sum + (c.participants?.length || 0), 0);

    res.json({
      success: true,
      data: {
        totalChallenges: challenges.length,
        activeChallenges: activeChallenges.length,
        totalParticipants,
        totalRewards: activeChallenges.reduce((sum, c) => sum + c.reward, 0)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
