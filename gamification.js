// ─── Gamified Safety Challenges Module ──────────────────────────────────────────
// Feature E: Drive long-term retention and safer behavior through positive reinforcement
// This module is fully independent — no modifications to existing files.

const express = require('express');
const router = express.Router();

// ─── In-Memory Data Store (production would use persistent DB) ──────────────────
// These simulate the new collections without altering existing schema
const gameProfiles = new Map();
const safetyTrips = new Map(); // userId → [trips]
const dailyPointsTracker = new Map(); // `${userId}_${date}` → pointsToday
const reportTracker = new Map(); // `${lat}_${lng}_${type}_${hourBucket}` → timestamp

// ─── Badge Definitions ──────────────────────────────────────────────────────────
const BADGE_DEFINITIONS = [
  { id: 'first_report', name: 'First Responder', trigger: 'reported_first_risk', icon: '🚨', description: 'Reported your very first road risk' },
  { id: 'week_streak', name: '7-Day Guardian', trigger: 'streak_days >= 7', icon: '🔥', description: 'Maintained a 7-day safety streak' },
  { id: '100_trips', name: 'Road Veteran', trigger: 'total_trips >= 100', icon: '🛣️', description: 'Completed 100 monitored trips' },
  { id: 'city_hero', name: 'City Navigator', trigger: 'urban_trips >= 50', icon: '🏙️', description: 'Completed 50 urban trips' },
  { id: 'top_10', name: 'Safety Champion', trigger: 'leaderboard_rank <= 10', icon: '🏆', description: 'Reached top 10 on the leaderboard' },
  { id: 'photo_reporter', name: 'Lens Guardian', trigger: 'photo_reports >= 5', icon: '📸', description: 'Captured 5 photo hazard reports' },
  { id: '10_trips', name: 'Road Rookie', trigger: 'total_trips >= 10', icon: '🚗', description: 'Completed 10 monitored trips' },
  { id: '50_trips', name: 'Highway Regular', trigger: 'total_trips >= 50', icon: '🏎️', description: 'Completed 50 monitored trips' },
  { id: 'streak_14', name: '14-Day Warrior', trigger: 'streak_days >= 14', icon: '⚡', description: 'Maintained a 14-day safety streak' },
  { id: 'streak_30', name: 'Monthly Guardian', trigger: 'streak_days >= 30', icon: '🌟', description: 'Maintained a 30-day safety streak' },
  { id: '5_confirms', name: 'Community Watcher', trigger: 'confirm_reports >= 5', icon: '👁️', description: 'Confirmed 5 community reports' },
  { id: 'safe_50', name: 'Golden Driver', trigger: 'safe_trips >= 50', icon: '🥇', description: 'Completed 50 safe trips (score ≥ 80)' }
];

// ─── Weekly Challenges (auto-generated) ─────────────────────────────────────────
let activeChallenges = [];
let lastChallengeGenTime = 0;

const CHALLENGE_TEMPLATES = [
  { name: 'Risk Reporter', description: 'Report 3 risks this week in your area', target: 3, metric: 'reports', reward: 200, rewardBadge: null },
  { name: 'Safe Commuter', description: 'Complete 5 safe trips with no CRITICAL zones', target: 5, metric: 'safe_trips', reward: 150, rewardBadge: 'streak_shield' },
  { name: 'Community Helper', description: 'Confirm 5 community reports', target: 5, metric: 'confirms', reward: 100, rewardBadge: null },
  { name: 'Photo Patrol', description: 'Submit 2 photo hazard reports', target: 2, metric: 'photo_reports', reward: 120, rewardBadge: null },
  { name: 'Distance Champion', description: 'Complete 20km of safe driving', target: 20, metric: 'safe_km', reward: 180, rewardBadge: null },
  { name: 'Peak Guardian', description: 'Complete 3 safe trips during peak hours (6-9am or 4-7pm)', target: 3, metric: 'peak_safe_trips', reward: 250, rewardBadge: null }
];

function generateWeeklyChallenges() {
  const now = Date.now();
  // Regenerate every Monday (or every 7 days from first generation)
  if (now - lastChallengeGenTime < 7 * 24 * 60 * 60 * 1000 && activeChallenges.length > 0) {
    return activeChallenges;
  }

  // Pick 3 random challenges
  const shuffled = [...CHALLENGE_TEMPLATES].sort(() => Math.random() - 0.5);
  activeChallenges = shuffled.slice(0, 3).map((template, idx) => ({
    id: `challenge_${Date.now()}_${idx}`,
    ...template,
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    participants: [],
    active: true
  }));

  lastChallengeGenTime = now;
  return activeChallenges;
}

// ─── Helper: Get or Create Game Profile ─────────────────────────────────────────
function getProfile(userId) {
  if (!gameProfiles.has(userId)) {
    gameProfiles.set(userId, {
      userId,
      totalScore: 0,
      totalTrips: 0,
      safeTrips: 0,
      urbanTrips: 0,
      streak: 0,
      longestStreak: 0,
      lastTripDate: null,
      streakFreezeTokens: 0,
      streakFreezeUsed: false,
      badges: [],
      reportsSubmitted: 0,
      reportsConfirmed: 0,
      photoReports: 0,
      tipsShared: 0,
      totalDistanceKm: 0,
      flagged: false,
      dailyTripCount: {},
      joinedChallenges: [],
      challengeProgress: {}
    });
  }
  return gameProfiles.get(userId);
}

// ─── Helper: Today's date string ────────────────────────────────────────────────
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// ─── Points Cap Check ───────────────────────────────────────────────────────────
function canEarnPoints(userId, pointsToAdd) {
  const key = `${userId}_${todayStr()}`;
  const current = dailyPointsTracker.get(key) || 0;
  if (current >= 500) return false;
  const allowed = Math.min(pointsToAdd, 500 - current);
  dailyPointsTracker.set(key, current + allowed);
  return allowed;
}

// ─── Anti-Manipulation: Duplicate Report Check ──────────────────────────────────
function isDuplicateReport(lat, lng, type) {
  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  const key = `${parseFloat(lat).toFixed(3)}_${parseFloat(lng).toFixed(3)}_${type}_${hourBucket}`;
  if (reportTracker.has(key)) return true;
  reportTracker.set(key, Date.now());
  // Clean old entries
  if (reportTracker.size > 1000) {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [k, v] of reportTracker) {
      if (v < cutoff) reportTracker.delete(k);
    }
  }
  return false;
}

// ─── Bot Detection ──────────────────────────────────────────────────────────────
function checkBotActivity(userId) {
  const profile = getProfile(userId);
  const hourKey = `${todayStr()}_${new Date().getHours()}`;
  if (!profile.dailyTripCount[hourKey]) profile.dailyTripCount[hourKey] = 0;
  profile.dailyTripCount[hourKey]++;

  if (profile.dailyTripCount[hourKey] > 10) {
    profile.flagged = true;
    return true;
  }
  return false;
}

// ─── Safety Score Calculation ───────────────────────────────────────────────────
function calculateTripScore(tripData) {
  let score = 100;

  // Deductions
  const highZones = tripData.highRiskZonesEntered || 0;
  const criticalZones = tripData.criticalZonesEntered || 0;
  const ignoredWarnings = tripData.ignoredWarnings || 0;

  score -= highZones * 5;
  score -= criticalZones * 15;
  score -= ignoredWarnings * 10;

  // Bonuses
  const risksReported = tripData.risksReported || 0;
  const reportsConfirmed = tripData.reportsConfirmed || 0;
  const tipsShared = tripData.tipsShared || 0;

  score += risksReported * 20;
  score += reportsConfirmed * 10;
  score += tipsShared * 5;

  // Safe trip bonus
  if (score >= 80) score += 15;

  // Environment normalization
  const distanceKm = tripData.distanceKm || 1;
  const riskZonesTotal = highZones + criticalZones;
  const urbanMultiplier = riskZonesTotal / Math.max(distanceKm, 0.1);

  if (urbanMultiplier > 2.0) {
    score = Math.round(score * 1.3);
  } else if (urbanMultiplier < 0.5) {
    score = Math.round(score * 0.9);
  }

  // Clamp
  return Math.max(0, Math.min(score, 200));
}

// ─── Streak Update ──────────────────────────────────────────────────────────────
function updateStreak(profile, tripScore) {
  const today = todayStr();

  if (tripScore >= 70) {
    if (profile.lastTripDate === today) {
      // Already logged today — streak maintained
      return;
    }

    const lastDate = profile.lastTripDate ? new Date(profile.lastTripDate) : null;
    const todayDate = new Date(today);

    if (lastDate) {
      const diffHours = (todayDate - lastDate) / (1000 * 60 * 60);

      if (diffHours <= 48) {
        // Within 48 hours — streak continues
        profile.streak++;
      } else if (!profile.streakFreezeUsed && profile.streakFreezeTokens > 0) {
        // Use streak freeze
        profile.streakFreezeTokens--;
        profile.streakFreezeUsed = true;
        profile.streak++;
      } else {
        // Streak broken
        profile.streak = 1;
        profile.streakFreezeUsed = false;
      }
    } else {
      profile.streak = 1;
    }

    // Award streak freeze tokens at 7-day milestones
    if (profile.streak > 0 && profile.streak % 7 === 0) {
      profile.streakFreezeTokens++;
    }

    profile.longestStreak = Math.max(profile.longestStreak, profile.streak);
    profile.lastTripDate = today;
  }
}

// ─── Badge Check ────────────────────────────────────────────────────────────────
function checkBadges(profile) {
  const newBadges = [];

  const checks = {
    'first_report': () => profile.reportsSubmitted >= 1,
    'week_streak': () => profile.streak >= 7,
    '100_trips': () => profile.totalTrips >= 100,
    'city_hero': () => profile.urbanTrips >= 50,
    'photo_reporter': () => profile.photoReports >= 5,
    '10_trips': () => profile.totalTrips >= 10,
    '50_trips': () => profile.totalTrips >= 50,
    'streak_14': () => profile.streak >= 14,
    'streak_30': () => profile.streak >= 30,
    '5_confirms': () => profile.reportsConfirmed >= 5,
    'safe_50': () => profile.safeTrips >= 50
  };

  for (const badge of BADGE_DEFINITIONS) {
    if (profile.badges.includes(badge.id)) continue;
    const check = checks[badge.id];
    if (check && check()) {
      profile.badges.push(badge.id);
      newBadges.push(badge);
    }
  }

  // Top 10 leaderboard badge
  if (!profile.badges.includes('top_10')) {
    const sorted = [...gameProfiles.values()]
      .filter(p => !p.flagged)
      .sort((a, b) => b.totalScore - a.totalScore);
    const rank = sorted.findIndex(p => p.userId === profile.userId) + 1;
    if (rank > 0 && rank <= 10) {
      profile.badges.push('top_10');
      newBadges.push(BADGE_DEFINITIONS.find(b => b.id === 'top_10'));
    }
  }

  return newBadges;
}

// ═══════════════════════════════════════════════════════════════════════════════
// API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/game/profile/:userId ──────────────────────────────────────────────
router.get('/profile/:userId', (req, res) => {
  try {
    const { userId } = req.params;
    const profile = getProfile(userId);

    // Compute rank
    const sorted = [...gameProfiles.values()]
      .filter(p => !p.flagged)
      .sort((a, b) => b.totalScore - a.totalScore);
    const rank = sorted.findIndex(p => p.userId === profile.userId) + 1;

    // Next badge progress
    let nextBadge = null;
    for (const badge of BADGE_DEFINITIONS) {
      if (!profile.badges.includes(badge.id)) {
        nextBadge = badge;
        break;
      }
    }

    // Map badge IDs to full badge objects
    const earnedBadges = profile.badges.map(id =>
      BADGE_DEFINITIONS.find(b => b.id === id)
    ).filter(Boolean);

    res.json({
      success: true,
      data: {
        userId: profile.userId,
        totalScore: profile.totalScore,
        totalTrips: profile.totalTrips,
        safeTrips: profile.safeTrips,
        streak: profile.streak,
        longestStreak: profile.longestStreak,
        streakFreezeTokens: profile.streakFreezeTokens,
        rank: rank || 'Unranked',
        badges: earnedBadges,
        allBadges: BADGE_DEFINITIONS.map(b => ({
          ...b,
          earned: profile.badges.includes(b.id)
        })),
        nextBadge,
        reportsSubmitted: profile.reportsSubmitted,
        reportsConfirmed: profile.reportsConfirmed,
        photoReports: profile.photoReports,
        totalDistanceKm: parseFloat(profile.totalDistanceKm.toFixed(1)),
        flagged: profile.flagged
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/game/log-trip ────────────────────────────────────────────────────
router.post('/log-trip', (req, res) => {
  try {
    const {
      userId = 'anonymous',
      distanceKm = 1,
      highRiskZonesEntered = 0,
      criticalZonesEntered = 0,
      ignoredWarnings = 0,
      risksReported = 0,
      reportsConfirmed = 0,
      tipsShared = 0,
      isUrban = false
    } = req.body;

    // Minimum trip distance check
    if (distanceKm < 0.5) {
      return res.json({
        success: true,
        data: { score: 0, message: 'Trip too short (< 0.5 km) — no points awarded' }
      });
    }

    // Bot detection
    if (checkBotActivity(userId)) {
      return res.json({
        success: true,
        data: { score: 0, message: 'Account flagged for review — too many trips this hour', flagged: true }
      });
    }

    const profile = getProfile(userId);

    // Calculate trip score
    const tripScore = calculateTripScore({
      distanceKm, highRiskZonesEntered, criticalZonesEntered,
      ignoredWarnings, risksReported, reportsConfirmed, tipsShared
    });

    // Apply daily cap
    const earnedPoints = canEarnPoints(userId, tripScore);
    if (earnedPoints === false) {
      return res.json({
        success: true,
        data: { score: tripScore, pointsAwarded: 0, message: 'Daily points cap (500) reached', capped: true }
      });
    }

    // Update profile
    profile.totalScore += earnedPoints;
    profile.totalTrips++;
    profile.totalDistanceKm += distanceKm;
    profile.reportsSubmitted += risksReported;
    profile.reportsConfirmed += reportsConfirmed;
    profile.tipsShared += tipsShared;

    if (isUrban) profile.urbanTrips++;
    if (tripScore >= 80) profile.safeTrips++;

    // Update streak
    updateStreak(profile, tripScore);

    // Check for new badges
    const newBadges = checkBadges(profile);

    // Store trip
    if (!safetyTrips.has(userId)) safetyTrips.set(userId, []);
    safetyTrips.get(userId).push({
      timestamp: new Date().toISOString(),
      score: tripScore,
      distanceKm,
      pointsAwarded: earnedPoints
    });

    // Keep only last 50 trips per user
    const trips = safetyTrips.get(userId);
    if (trips.length > 50) safetyTrips.set(userId, trips.slice(-50));

    res.json({
      success: true,
      data: {
        score: tripScore,
        pointsAwarded: earnedPoints,
        totalScore: profile.totalScore,
        streak: profile.streak,
        newBadges: newBadges.map(b => ({ id: b.id, name: b.name, icon: b.icon })),
        rank: getLeaderboardRank(userId)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/game/log-report ──────────────────────────────────────────────────
// Award points for risk report submission (called silently after report)
router.post('/log-report', (req, res) => {
  try {
    const { userId = 'anonymous', lat, lng, type, isPhoto = false, isConfirmation = false } = req.body;

    const profile = getProfile(userId);

    // Duplicate check
    if (lat && lng && type && isDuplicateReport(lat, lng, type)) {
      return res.json({ success: true, data: { points: 0, message: 'Duplicate report — no points' } });
    }

    let points = 0;

    if (isConfirmation) {
      points = 10;
      profile.reportsConfirmed++;
    } else {
      points = 20;
      profile.reportsSubmitted++;
      if (isPhoto) {
        profile.photoReports++;
      }
    }

    const earnedPoints = canEarnPoints(userId, points);
    if (earnedPoints) {
      profile.totalScore += earnedPoints;
    }

    const newBadges = checkBadges(profile);

    res.json({
      success: true,
      data: {
        pointsAwarded: earnedPoints || 0,
        totalScore: profile.totalScore,
        newBadges: newBadges.map(b => ({ id: b.id, name: b.name, icon: b.icon }))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/game/challenges/active ────────────────────────────────────────────
router.get('/challenges/active', (req, res) => {
  try {
    const challenges = generateWeeklyChallenges();
    const userId = req.query.userId || 'anonymous';
    const profile = getProfile(userId);

    const withProgress = challenges.map(c => ({
      ...c,
      joined: profile.joinedChallenges.includes(c.id),
      progress: profile.challengeProgress[c.id] || 0,
      completed: (profile.challengeProgress[c.id] || 0) >= c.target
    }));

    res.json({ success: true, data: withProgress });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/game/challenges/join/:id ─────────────────────────────────────────
router.post('/challenges/join/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { userId = 'anonymous' } = req.body;
    const profile = getProfile(userId);

    const challenges = generateWeeklyChallenges();
    const challenge = challenges.find(c => c.id === id);

    if (!challenge) {
      return res.status(404).json({ success: false, error: 'Challenge not found' });
    }

    if (profile.joinedChallenges.includes(id)) {
      return res.json({ success: true, data: { message: 'Already joined', alreadyJoined: true } });
    }

    profile.joinedChallenges.push(id);
    if (!challenge.participants.includes(userId)) {
      challenge.participants.push(userId);
    }
    profile.challengeProgress[id] = 0;

    res.json({
      success: true,
      data: { message: 'Challenge joined!', challengeId: id, challengeName: challenge.name }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/game/leaderboard ──────────────────────────────────────────────────
router.get('/leaderboard', (req, res) => {
  try {
    const sorted = [...gameProfiles.values()]
      .filter(p => !p.flagged)
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, 20);

    const leaderboard = sorted.map((p, idx) => ({
      rank: idx + 1,
      username: `SafeDriver_${Math.abs(hashCode(p.userId)) % 10000}`,
      score: p.totalScore,
      trips: p.totalTrips,
      streak: p.streak,
      topBadge: p.badges.length > 0
        ? BADGE_DEFINITIONS.find(b => b.id === p.badges[p.badges.length - 1])
        : null
    }));

    res.json({ success: true, data: leaderboard });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Helper: Simple hash code for anonymization ─────────────────────────────────
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash;
}

function getLeaderboardRank(userId) {
  const sorted = [...gameProfiles.values()]
    .filter(p => !p.flagged)
    .sort((a, b) => b.totalScore - a.totalScore);
  const idx = sorted.findIndex(p => p.userId === userId);
  return idx >= 0 ? idx + 1 : null;
}

// ─── Admin Integration Functions ────────────────────────────────────────────────
function getActiveChallengesExport() {
  return generateWeeklyChallenges();
}

function addAdminChallenge(challenge) {
  // Add admin-created challenge to the active challenges list
  activeChallenges.push(challenge);
}

function removeAdminChallenge(id) {
  const idx = activeChallenges.findIndex(c => c.id === id);
  if (idx !== -1) activeChallenges.splice(idx, 1);
}

// ─── Export router + admin helpers ──────────────────────────────────────────────
module.exports = router;
module.exports.getActiveChallenges = getActiveChallengesExport;
module.exports.addAdminChallenge = addAdminChallenge;
module.exports.removeAdminChallenge = removeAdminChallenge;
