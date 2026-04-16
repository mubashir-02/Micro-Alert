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

module.exports = router;
