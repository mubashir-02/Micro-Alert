// ─── Gamification Panel — Feature E Frontend ────────────────────────────────────
// Collapsible side panel showing stats, challenges, badges, leaderboard.
// All calls are fire-and-forget — no blocking of existing UI.

(function () {
  'use strict';

  // ─── State ──────────────────────────────────────────────────────────────────
  const GAME_USER_ID = 'user_' + (Math.random().toString(36).substring(2, 8));
  let gameProfile = null;
  let gamePanelOpen = false;
  let toastQueue = [];
  let isShowingToast = false;

  // ─── Wait for DOM ───────────────────────────────────────────────────────────
  function init() {
    try {
      createGameFAB();
      createGamePanel();
      hookIntoExistingActions();
      loadGameProfile();

      // Refresh profile every 60 seconds
      setInterval(loadGameProfile, 60 * 1000);

      console.log('✅ Gamification panel initialized');
    } catch (err) {
      console.warn('Gamification init failed (degrading gracefully):', err.message);
    }
  }

  // ─── Get User ID ────────────────────────────────────────────────────────────
  function getUserId() {
    let stored = null;
    try { stored = localStorage.getItem('ma_game_userId'); } catch (e) {}
    if (stored) return stored;
    try { localStorage.setItem('ma_game_userId', GAME_USER_ID); } catch (e) {}
    return GAME_USER_ID;
  }

  // ─── Create FAB Button ──────────────────────────────────────────────────────
  function createGameFAB() {
    const fab = document.createElement('button');
    fab.id = 'gameFab';
    fab.className = 'game-fab';
    fab.innerHTML = '🏆';
    fab.title = 'Safety Challenges';
    fab.onclick = toggleGamePanel;

    const mapContainer = document.querySelector('.map-container');
    if (mapContainer) {
      mapContainer.appendChild(fab);
    } else {
      document.body.appendChild(fab);
    }
  }

  // ─── Create Game Panel ──────────────────────────────────────────────────────
  function createGamePanel() {
    const panel = document.createElement('div');
    panel.id = 'gamePanel';
    panel.className = 'game-panel';

    panel.innerHTML = `
      <div class="game-panel-header">
        <h3>🏆 Safety Challenges</h3>
        <button class="game-panel-close" onclick="document.getElementById('gamePanel').classList.remove('visible')">&times;</button>
      </div>
      <div class="game-panel-body">

        <!-- MY STATS Section -->
        <div class="game-section" id="gameStatsSection">
          <div class="game-section-title">📊 My Stats</div>
          <div class="game-stats-grid" id="gameStatsGrid">
            <div class="game-stat">
              <div class="game-stat-value" id="gameTotalScore">0</div>
              <div class="game-stat-label">Score</div>
            </div>
            <div class="game-stat">
              <div class="game-stat-value game-streak" id="gameStreak">
                <span class="streak-fire">🔥</span> <span id="gameStreakNum">0</span>
              </div>
              <div class="game-stat-label">Day Streak</div>
            </div>
            <div class="game-stat">
              <div class="game-stat-value" id="gameRank">#—</div>
              <div class="game-stat-label">Rank</div>
            </div>
            <div class="game-stat">
              <div class="game-stat-value" id="gameTrips">0</div>
              <div class="game-stat-label">Trips</div>
            </div>
          </div>
          <div class="game-progress-section" id="gameProgressSection">
            <div class="game-progress-label" id="gameNextBadgeLabel">Next badge: —</div>
            <div class="game-progress-bar">
              <div class="game-progress-fill" id="gameProgressFill" style="width:0%"></div>
            </div>
          </div>
        </div>

        <!-- ACTIVE CHALLENGES Section -->
        <div class="game-section" id="gameChallengesSection">
          <div class="game-section-title" style="display:flex;align-items:center;justify-content:space-between;">
            🎯 Active Challenges
            <a href="/admin" target="_blank" style="font-size:9px;color:var(--accent-cyan);text-decoration:none;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">⚙️ Manage</a>
          </div>
          <div class="game-challenges-list" id="gameChallengesList">
            <div class="game-loading">Loading challenges...</div>
          </div>
        </div>

        <!-- BADGES Section -->
        <div class="game-section" id="gameBadgesSection">
          <div class="game-section-title">🏅 Badges</div>
          <div class="game-badges-grid" id="gameBadgesGrid">
            <!-- Populated by JS -->
          </div>
        </div>

        <!-- LEADERBOARD Section -->
        <div class="game-section" id="gameLeaderboardSection">
          <div class="game-section-title">🏅 Leaderboard</div>
          <div class="game-leaderboard" id="gameLeaderboard">
            <div class="game-loading">Loading leaderboard...</div>
          </div>
        </div>
      </div>
    `;

    const mapContainer = document.querySelector('.map-container');
    if (mapContainer) {
      mapContainer.appendChild(panel);
    } else {
      document.body.appendChild(panel);
    }
  }

  // ─── Toggle Panel ───────────────────────────────────────────────────────────
  function toggleGamePanel() {
    const panel = document.getElementById('gamePanel');
    if (!panel) return;
    gamePanelOpen = !gamePanelOpen;
    panel.classList.toggle('visible', gamePanelOpen);
    if (gamePanelOpen) {
      loadGameProfile();
      loadChallenges();
      loadLeaderboard();
    }
  }

  // ─── Load Game Profile ──────────────────────────────────────────────────────
  async function loadGameProfile() {
    try {
      const userId = getUserId();
      const res = await fetch(`/api/game/profile/${userId}`);
      const json = await res.json();

      if (json.success && json.data) {
        gameProfile = json.data;
        renderProfile(json.data);
      }
    } catch (err) {
      // Silent fail — gamification is non-critical
    }
  }

  // ─── Render Profile ─────────────────────────────────────────────────────────
  function renderProfile(data) {
    const scoreEl = document.getElementById('gameTotalScore');
    const streakEl = document.getElementById('gameStreakNum');
    const rankEl = document.getElementById('gameRank');
    const tripsEl = document.getElementById('gameTrips');

    if (scoreEl) scoreEl.textContent = data.totalScore.toLocaleString();
    if (streakEl) streakEl.textContent = data.streak;
    if (rankEl) rankEl.textContent = typeof data.rank === 'number' ? `#${data.rank}` : data.rank;
    if (tripsEl) tripsEl.textContent = data.totalTrips;

    // Streak fire animation
    const streakFire = document.querySelector('.streak-fire');
    if (streakFire && data.streak >= 3) {
      streakFire.classList.add('animated');
    }

    // Next badge progress
    if (data.nextBadge) {
      const labelEl = document.getElementById('gameNextBadgeLabel');
      const fillEl = document.getElementById('gameProgressFill');
      if (labelEl) labelEl.textContent = `Next: ${data.nextBadge.icon} ${data.nextBadge.name}`;
      // Estimate progress (simplified)
      const progress = Math.min((data.totalTrips / 10) * 100, 95);
      if (fillEl) fillEl.style.width = progress + '%';
    }

    // Render badges grid
    renderBadges(data.allBadges || []);
  }

  // ─── Render Badges ──────────────────────────────────────────────────────────
  function renderBadges(allBadges) {
    const grid = document.getElementById('gameBadgesGrid');
    if (!grid) return;

    grid.innerHTML = allBadges.map(badge => `
      <div class="game-badge ${badge.earned ? 'earned' : 'locked'}" title="${badge.description || badge.name}">
        <div class="game-badge-icon">${badge.icon}</div>
        <div class="game-badge-name">${badge.name}</div>
      </div>
    `).join('');
  }

  // ─── Load Challenges ────────────────────────────────────────────────────────
  async function loadChallenges() {
    try {
      const userId = getUserId();
      const res = await fetch(`/api/game/challenges/active?userId=${userId}`);
      const json = await res.json();

      if (json.success && json.data) {
        renderChallenges(json.data);
      }
    } catch (err) {
      const list = document.getElementById('gameChallengesList');
      if (list) list.innerHTML = '<div class="game-empty">Challenges unavailable</div>';
    }
  }

  // ─── Render Challenges ──────────────────────────────────────────────────────
  function renderChallenges(challenges) {
    const list = document.getElementById('gameChallengesList');
    if (!list) return;

    if (challenges.length === 0) {
      list.innerHTML = '<div class="game-empty">No active challenges</div>';
      return;
    }

    list.innerHTML = challenges.map(c => {
      const progressPercent = Math.min((c.progress / c.target) * 100, 100);
      const isComplete = c.completed;

      return `
        <div class="game-challenge-card ${isComplete ? 'completed' : ''}">
          <div class="challenge-header">
            <div class="challenge-name">${c.name}</div>
            <div class="challenge-reward">+${c.reward} pts</div>
          </div>
          <div class="challenge-desc">${c.description}</div>
          <div class="challenge-progress">
            <div class="challenge-progress-bar">
              <div class="challenge-progress-fill" style="width:${progressPercent}%"></div>
            </div>
            <div class="challenge-progress-text">${c.progress || 0}/${c.target}</div>
          </div>
          ${!c.joined && !isComplete
            ? `<button class="challenge-join-btn" onclick="window.MicroAlertGame.joinChallenge('${c.id}')">Join Challenge</button>`
            : isComplete
              ? '<div class="challenge-complete-badge">✅ Completed!</div>'
              : '<div class="challenge-joined-badge">✔ Joined</div>'
          }
        </div>
      `;
    }).join('');
  }

  // ─── Load Leaderboard ───────────────────────────────────────────────────────
  async function loadLeaderboard() {
    try {
      const res = await fetch('/api/game/leaderboard');
      const json = await res.json();

      if (json.success && json.data) {
        renderLeaderboard(json.data);
      }
    } catch (err) {
      const el = document.getElementById('gameLeaderboard');
      if (el) el.innerHTML = '<div class="game-empty">Leaderboard unavailable</div>';
    }
  }

  // ─── Render Leaderboard ─────────────────────────────────────────────────────
  function renderLeaderboard(entries) {
    const el = document.getElementById('gameLeaderboard');
    if (!el) return;

    if (entries.length === 0) {
      el.innerHTML = '<div class="game-empty">No entries yet. Start driving safely!</div>';
      return;
    }

    el.innerHTML = entries.slice(0, 10).map(entry => {
      const rankBadge = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `#${entry.rank}`;
      return `
        <div class="leaderboard-row ${entry.rank <= 3 ? 'top3' : ''}">
          <div class="lb-rank">${rankBadge}</div>
          <div class="lb-info">
            <div class="lb-name">${entry.username}</div>
            <div class="lb-meta">${entry.trips} trips · 🔥${entry.streak}</div>
          </div>
          <div class="lb-score">${entry.score.toLocaleString()}</div>
        </div>
      `;
    }).join('');
  }

  // ─── Join Challenge ─────────────────────────────────────────────────────────
  async function joinChallenge(challengeId) {
    try {
      const userId = getUserId();
      const res = await fetch(`/api/game/challenges/join/${challengeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      const json = await res.json();
      if (json.success) {
        queueToast(`🎯 Joined: ${json.data.challengeName}`, 'success');
        loadChallenges();
      }
    } catch (err) { /* silent */ }
  }

  // ─── Hook Into Existing Actions (fire-and-forget) ───────────────────────────
  function hookIntoExistingActions() {
    // Intercept risk report submissions
    const originalSubmitReport = window.submitReport;
    if (typeof originalSubmitReport === 'function') {
      window.submitReport = async function () {
        await originalSubmitReport.apply(this, arguments);

        // Fire-and-forget: log report to game
        try {
          const userId = getUserId();
          const lat = window.pickedLatLng?.lat;
          const lng = window.pickedLatLng?.lng;
          const type = document.getElementById('reportType')?.value;
          const hasPhoto = (window.capturedPhotos?.length > 0);

          fetch('/api/game/log-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, lat, lng, type, isPhoto: hasPhoto })
          }).then(r => r.json()).then(json => {
            if (json.success && json.data) {
              if (json.data.pointsAwarded > 0) {
                queueToast(`+${json.data.pointsAwarded} pts for reporting!`, 'success');
              }
              if (json.data.newBadges && json.data.newBadges.length > 0) {
                json.data.newBadges.forEach(b => {
                  queueToast(`🏆 New Badge: ${b.icon} ${b.name}!`, 'badge');
                });
              }
            }
          }).catch(() => { /* silent */ });
        } catch (e) { /* silent */ }
      };
    }

    // Listen for trip end events (via socket or custom event)
    document.addEventListener('trip-ended', (e) => {
      logTripSilently(e.detail || {});
    });

    // Listen for journey stop from voice assistant
    const originalStopJourney = window.stopJourney;
    if (typeof originalStopJourney === 'function') {
      window.stopJourney = function () {
        // Call original
        originalStopJourney.apply(this, arguments);

        // Fire-and-forget trip log
        logTripSilently({
          distanceKm: Math.random() * 10 + 1, // placeholder — would come from actual tracking
          highRiskZonesEntered: 0,
          criticalZonesEntered: 0
        });
      };
    }
  }

  // ─── Log Trip Silently ──────────────────────────────────────────────────────
  function logTripSilently(tripData) {
    try {
      const userId = getUserId();
      fetch('/api/game/log-trip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          distanceKm: tripData.distanceKm || 2,
          highRiskZonesEntered: tripData.highRiskZonesEntered || 0,
          criticalZonesEntered: tripData.criticalZonesEntered || 0,
          ignoredWarnings: tripData.ignoredWarnings || 0,
          risksReported: tripData.risksReported || 0,
          reportsConfirmed: tripData.reportsConfirmed || 0,
          isUrban: tripData.isUrban || true
        })
      }).then(r => r.json()).then(json => {
        if (json.success && json.data) {
          if (json.data.pointsAwarded > 0) {
            queueToast(`🚗 Trip logged! +${json.data.pointsAwarded} pts`, 'success');
          }
          if (json.data.newBadges && json.data.newBadges.length > 0) {
            json.data.newBadges.forEach(b => {
              queueToast(`🏆 New Badge: ${b.icon} ${b.name}!`, 'badge');
            });
          }
          // Update streak display
          const streakEl = document.getElementById('gameStreakNum');
          if (streakEl) streakEl.textContent = json.data.streak;
        }
      }).catch(() => { /* silent */ });
    } catch (e) { /* silent */ }
  }

  // ─── Toast Queue System ─────────────────────────────────────────────────────
  function queueToast(message, type = 'success') {
    toastQueue.push({ message, type });
    processToastQueue();
  }

  function processToastQueue() {
    if (isShowingToast || toastQueue.length === 0) return;
    isShowingToast = true;

    const { message, type } = toastQueue.shift();
    showGameToast(message, type);
  }

  function showGameToast(message, type) {
    const toast = document.createElement('div');
    toast.className = `game-toast game-toast-${type}`;
    toast.textContent = message;

    const duration = type === 'badge' ? 4000 : 3000;
    if (type === 'badge') {
      toast.classList.add('center-toast');
    }

    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.classList.add('visible');
    });

    // Auto dismiss
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => {
        toast.remove();
        isShowingToast = false;
        processToastQueue();
      }, 300);
    }, duration);
  }

  // ─── Expose to global scope ─────────────────────────────────────────────────
  window.MicroAlertGame = {
    toggle: toggleGamePanel,
    logTrip: logTripSilently,
    joinChallenge: joinChallenge,
    getProfile: () => gameProfile,
    getUserId: getUserId
  };

  // ─── Initialize ─────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
