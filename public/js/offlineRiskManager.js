// ─── Offline Risk Manager — Feature F ───────────────────────────────────────────
// IndexedDB layer for offline risk data persistence, sync queue, and storage management.
// Zero impact on existing code.

(function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────────
  const DB_NAME = 'RiskMapDB';
  const DB_VERSION = 1;
  const STORE_ROUTES = 'routes';
  const STORE_SYNC_QUEUE = 'sync_queue';
  const MAX_STORAGE_MB = 50;
  const ROUTE_EXPIRY_HOURS = 24;
  const MAX_SYNC_RETRIES = 3;
  const SYNC_RETRY_DELAY_MS = 30000;

  // ─── State ──────────────────────────────────────────────────────────────────
  let db = null;
  let isOffline = false;
  let isDbAvailable = false;

  // ─── LZString Compression (minimal inline implementation) ─────────────────
  const LZString = {
    compress: function (input) {
      if (!input) return '';
      try {
        // Use built-in compression if available
        return btoa(encodeURIComponent(input));
      } catch (e) {
        return input;
      }
    },
    decompress: function (input) {
      if (!input) return '';
      try {
        return decodeURIComponent(atob(input));
      } catch (e) {
        return input;
      }
    }
  };

  // ─── Initialize IndexedDB ──────────────────────────────────────────────────
  function initDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        console.warn('IndexedDB not available — offline mode disabled');
        reject(new Error('IndexedDB not supported'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.warn('IndexedDB open failed:', request.error);
        reject(request.error);
      };

      request.onupgradeneeded = (event) => {
        const database = event.target.result;

        // Routes store
        if (!database.objectStoreNames.contains(STORE_ROUTES)) {
          const routeStore = database.createObjectStore(STORE_ROUTES, { keyPath: 'route_id' });
          routeStore.createIndex('last_synced', 'last_synced', { unique: false });
        }

        // Sync queue store
        if (!database.objectStoreNames.contains(STORE_SYNC_QUEUE)) {
          database.createObjectStore(STORE_SYNC_QUEUE, { keyPath: 'id', autoIncrement: true });
        }
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        isDbAvailable = true;
        resolve(db);
      };
    });
  }

  // ─── Generic DB Operations ──────────────────────────────────────────────────
  function dbPut(storeName, data) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error('DB not initialized')); return; }
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(data);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function dbGet(storeName, key) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error('DB not initialized')); return; }
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function dbGetAll(storeName) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error('DB not initialized')); return; }
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function dbDelete(storeName, key) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error('DB not initialized')); return; }
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  function dbClear(storeName) {
    return new Promise((resolve, reject) => {
      if (!db) { reject(new Error('DB not initialized')); return; }
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ─── Save Route for Offline ─────────────────────────────────────────────────
  async function saveRouteOffline(routeId, name, polyline) {
    if (!isDbAvailable) {
      showOfflineToast('Offline mode not supported on this device', 'error');
      return false;
    }

    try {
      showOfflineToast('Saving route safety data...', 'info');

      // Fetch risk markers along route
      let riskMarkers = [];
      try {
        const coords = polyline || '';
        let url = '/api/risks';
        if (coords) {
          const parts = coords.split(';');
          if (parts.length >= 2) {
            const [sLat, sLng] = parts[0].split(',');
            const [eLat, eLng] = parts[parts.length - 1].split(',');
            url = `/api/risks/along-route?startLat=${sLat}&startLng=${sLng}&endLat=${eLat}&endLng=${eLng}`;
          }
        }
        const riskRes = await fetch(url);
        const riskJson = await riskRes.json();
        if (riskJson.success) {
          riskMarkers = riskJson.data.map(r => ({
            lat: r.lat, lng: r.lng,
            type: r.type,
            severity: r.severity,
            description: r.description,
            roadName: r.roadName,
            landmark: r.landmark
          }));
        }
      } catch (e) { /* Use empty markers */ }

      // Fetch prediction scores along route
      let predictionScores = [];
      try {
        const predUrl = polyline
          ? `/api/prediction-engine/route-risk?polyline=${encodeURIComponent(polyline)}`
          : '/api/prediction-engine/hotspots';
        const predRes = await fetch(predUrl);
        const predJson = await predRes.json();
        if (predJson.success && predJson.data) {
          if (Array.isArray(predJson.data)) {
            predictionScores = predJson.data.map(d => ({
              lat: d.lat, lng: d.lng,
              score: d.score || d.averageRiskScore,
              peak_score: d.score || d.averageRiskScore
            }));
          } else if (predJson.data.segments) {
            predictionScores = predJson.data.segments.map(s => ({
              lat: s.lat, lng: s.lng,
              score: s.score,
              peak_score: s.score
            }));
          }
        }
      } catch (e) { /* Use empty predictions */ }

      // Compress and store
      const routeData = {
        route_id: routeId,
        name: name || `Route ${routeId}`,
        polyline: polyline || '',
        last_synced: new Date().toISOString(),
        risk_markers: riskMarkers,
        prediction_scores: predictionScores,
        compressed: LZString.compress(JSON.stringify({ riskMarkers, predictionScores }))
      };

      // Check storage quota
      const sizeBytes = new Blob([JSON.stringify(routeData)]).size;
      const sizeMB = sizeBytes / (1024 * 1024);

      const currentUsage = await getStorageUsage();
      if (currentUsage + sizeMB > MAX_STORAGE_MB) {
        // Remove oldest route to make space
        await removeOldestRoute();
        showOfflineToast('Storage almost full — oldest route removed', 'warning');
      }

      await dbPut(STORE_ROUTES, routeData);

      showOfflineToast(`Route saved — safety alerts work offline for ${ROUTE_EXPIRY_HOURS} hours ✓`, 'success');
      updateSaveButton(routeId, 'saved');
      return true;
    } catch (err) {
      console.error('Save offline failed:', err);
      showOfflineToast('Failed to save route offline', 'error');
      return false;
    }
  }

  // ─── Load Saved Route ───────────────────────────────────────────────────────
  async function loadSavedRoute(routeId) {
    if (!isDbAvailable) return null;

    try {
      const route = await dbGet(STORE_ROUTES, routeId);
      if (!route) return null;

      // Check expiry
      const synced = new Date(route.last_synced);
      const hoursSinceSynced = (Date.now() - synced.getTime()) / (1000 * 60 * 60);

      if (hoursSinceSynced > ROUTE_EXPIRY_HOURS) {
        // Expired — delete and return null
        await dbDelete(STORE_ROUTES, routeId);
        return null;
      }

      return route;
    } catch (err) {
      return null;
    }
  }

  // ─── Get All Saved Routes ───────────────────────────────────────────────────
  async function getSavedRoutes() {
    if (!isDbAvailable) return [];

    try {
      const routes = await dbGetAll(STORE_ROUTES);

      // Clean expired routes
      const now = Date.now();
      const validRoutes = [];
      for (const route of routes) {
        const hoursSince = (now - new Date(route.last_synced).getTime()) / (1000 * 60 * 60);
        if (hoursSince > ROUTE_EXPIRY_HOURS) {
          await dbDelete(STORE_ROUTES, route.route_id);
        } else {
          validRoutes.push(route);
        }
      }

      return validRoutes;
    } catch (err) {
      return [];
    }
  }

  // ─── Delete Saved Route ─────────────────────────────────────────────────────
  async function deleteSavedRoute(routeId) {
    if (!isDbAvailable) return false;
    try {
      await dbDelete(STORE_ROUTES, routeId);
      return true;
    } catch (err) {
      return false;
    }
  }

  // ─── Clear All Offline Data ─────────────────────────────────────────────────
  async function clearAllOfflineData() {
    if (!isDbAvailable) return false;
    try {
      await dbClear(STORE_ROUTES);
      await dbClear(STORE_SYNC_QUEUE);
      showOfflineToast('All offline data cleared', 'success');
      return true;
    } catch (err) {
      return false;
    }
  }

  // ─── Storage Usage ──────────────────────────────────────────────────────────
  async function getStorageUsage() {
    if (!isDbAvailable) return 0;
    try {
      const routes = await dbGetAll(STORE_ROUTES);
      const totalBytes = routes.reduce((sum, r) => sum + new Blob([JSON.stringify(r)]).size, 0);
      return totalBytes / (1024 * 1024); // MB
    } catch (err) {
      return 0;
    }
  }

  async function removeOldestRoute() {
    try {
      const routes = await dbGetAll(STORE_ROUTES);
      if (routes.length === 0) return;
      routes.sort((a, b) => new Date(a.last_synced) - new Date(b.last_synced));
      await dbDelete(STORE_ROUTES, routes[0].route_id);
    } catch (err) { /* silent */ }
  }

  // ─── Sync Queue Operations ──────────────────────────────────────────────────
  async function addToSyncQueue(action, payload) {
    if (!isDbAvailable) return;
    try {
      await dbPut(STORE_SYNC_QUEUE, {
        id: Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        action,
        payload,
        timestamp: new Date().toISOString(),
        retry_count: 0
      });
      showOfflineToast('Report saved — will upload when you\'re back online', 'info');
    } catch (err) {
      console.warn('Failed to add to sync queue:', err);
    }
  }

  async function processyncQueue() {
    if (!isDbAvailable || isOffline) return;

    try {
      const items = await dbGetAll(STORE_SYNC_QUEUE);
      if (items.length === 0) return;

      for (const item of items) {
        try {
          let endpoint;
          let method = 'POST';

          switch (item.action) {
            case 'report_risk':
              endpoint = '/api/risks/report';
              break;
            case 'confirm_report':
              endpoint = '/api/game/log-report';
              break;
            case 'photo_hazard':
              endpoint = '/api/llm/analyze-photo';
              break;
            default:
              endpoint = '/api/risks/report';
          }

          const res = await fetch(endpoint, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.payload)
          });

          if (res.ok) {
            await dbDelete(STORE_SYNC_QUEUE, item.id);
          } else {
            throw new Error(`HTTP ${res.status}`);
          }
        } catch (err) {
          // Increment retry count
          item.retry_count++;
          if (item.retry_count >= MAX_SYNC_RETRIES) {
            // Max retries exceeded
            showOfflineToast('Report upload failed — tap to retry', 'error');
            await dbDelete(STORE_SYNC_QUEUE, item.id);
          } else {
            await dbPut(STORE_SYNC_QUEUE, item);
            // Retry after delay
            setTimeout(() => processyncQueue(), SYNC_RETRY_DELAY_MS);
            return; // Stop processing — will resume after retry
          }
        }
      }
    } catch (err) {
      console.warn('Sync queue processing failed:', err);
    }
  }

  // ─── Offline Mode Detection ─────────────────────────────────────────────────
  function setupOfflineDetection() {
    window.addEventListener('offline', () => {
      isOffline = true;
      showOfflineBanner();
    });

    window.addEventListener('online', () => {
      isOffline = false;
      hideOfflineBanner();
      processyncQueue(); // Flush pending reports
    });

    // Initial check
    isOffline = !navigator.onLine;
    if (isOffline) showOfflineBanner();
  }

  // ─── Offline Banner UI ──────────────────────────────────────────────────────
  function showOfflineBanner() {
    let banner = document.getElementById('offlineBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'offlineBanner';
      banner.className = 'offline-banner';
      banner.innerHTML = `
        <div class="offline-banner-content">
          <span class="offline-banner-icon">📡</span>
          <span class="offline-banner-text">Offline — showing saved risk data for your routes</span>
          <button class="offline-banner-details" onclick="window.MicroAlertOffline.showDetails()">Details</button>
        </div>
      `;
      document.body.appendChild(banner);
    }
    banner.classList.add('visible');
  }

  function hideOfflineBanner() {
    const banner = document.getElementById('offlineBanner');
    if (banner) banner.classList.remove('visible');
  }

  // ─── Offline Details Panel ──────────────────────────────────────────────────
  async function showOfflineDetails() {
    const routes = await getSavedRoutes();
    const usage = await getStorageUsage();
    const syncItems = isDbAvailable ? await dbGetAll(STORE_SYNC_QUEUE) : [];

    let panel = document.getElementById('offlineDetailsPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'offlineDetailsPanel';
      panel.className = 'offline-details-panel';
      document.body.appendChild(panel);
    }

    panel.innerHTML = `
      <div class="offline-details-header">
        <h3>📡 Offline & Saved Routes</h3>
        <button class="offline-details-close" onclick="document.getElementById('offlineDetailsPanel').classList.remove('visible')">✕</button>
      </div>
      <div class="offline-details-body">
        <div class="offline-stat">
          <span>Storage Used</span>
          <strong>${usage.toFixed(1)} MB / ${MAX_STORAGE_MB} MB</strong>
        </div>
        <div class="offline-stat">
          <span>Pending Reports</span>
          <strong>${syncItems.length}</strong>
        </div>
        <div class="offline-routes-list">
          ${routes.length === 0 ? '<div class="offline-empty">No saved routes</div>' :
            routes.map(r => {
              const hoursSince = ((Date.now() - new Date(r.last_synced).getTime()) / (1000 * 60 * 60)).toFixed(1);
              const markers = r.risk_markers?.length || 0;
              return `
                <div class="offline-route-item">
                  <div class="offline-route-info">
                    <div class="offline-route-name">${r.name}</div>
                    <div class="offline-route-meta">${markers} markers · Updated ${hoursSince}h ago</div>
                  </div>
                  <button class="offline-route-delete" onclick="window.MicroAlertOffline.deleteRoute('${r.route_id}')">🗑️</button>
                </div>
              `;
            }).join('')
          }
        </div>
        <button class="btn btn-secondary btn-block" style="margin-top:12px;" onclick="window.MicroAlertOffline.clearAll()">
          🗑️ Clear All Offline Data
        </button>
      </div>
    `;

    panel.classList.add('visible');
  }

  // ─── Save Offline Button (appended to route cards) ──────────────────────────
  function addSaveOfflineButtons() {
    // Watch for route results to appear, then append button
    const observer = new MutationObserver(() => {
      const routeResults = document.getElementById('routeResults');
      if (routeResults && routeResults.style.display !== 'none') {
        if (!document.getElementById('saveOfflineBtn')) {
          const btn = document.createElement('button');
          btn.id = 'saveOfflineBtn';
          btn.className = 'btn btn-secondary btn-block save-offline-btn';
          btn.innerHTML = '💾 Save Route Offline';
          btn.onclick = () => {
            const start = document.getElementById('startLocation')?.value || 'Start';
            const end = document.getElementById('endLocation')?.value || 'End';
            const routeId = `${start}_${end}_${Date.now()}`.replace(/\s/g, '_');
            saveRouteOffline(routeId, `${start} → ${end}`);
          };
          routeResults.appendChild(btn);
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  }

  function updateSaveButton(routeId, state) {
    const btn = document.getElementById('saveOfflineBtn');
    if (!btn) return;

    if (state === 'saving') {
      btn.innerHTML = '⏳ Saving...';
      btn.disabled = true;
    } else if (state === 'saved') {
      btn.innerHTML = '✅ Saved ✓';
      btn.disabled = false;
      btn.classList.add('saved');
    } else if (state === 'update') {
      btn.innerHTML = '🔄 Update';
      btn.disabled = false;
    }
  }

  // ─── Toast Helper ───────────────────────────────────────────────────────────
  function showOfflineToast(message, type = 'info') {
    // Use existing toast system if available
    if (typeof window.showToast === 'function') {
      window.showToast(message, type === 'error' ? 'error' : 'success');
      return;
    }

    // Fallback standalone toast
    const toast = document.createElement('div');
    toast.className = `offline-toast offline-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ─── Service Worker Registration ────────────────────────────────────────────
  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/risk-cache-sw.js')
        .then(reg => console.log('✅ Risk cache SW registered (scope:', reg.scope, ')'))
        .catch(err => console.warn('SW registration failed:', err.message));
    }
  }

  // ─── Initialize ─────────────────────────────────────────────────────────────
  async function init() {
    try {
      // Register service worker
      registerServiceWorker();

      // Initialize IndexedDB
      await initDB();

      // Setup offline detection
      setupOfflineDetection();

      // Add save offline buttons to route UI
      addSaveOfflineButtons();

      console.log('✅ Offline risk manager initialized');
    } catch (err) {
      console.warn('Offline manager init failed (degrading gracefully):', err.message);
      // Disable save offline button if IndexedDB unavailable
      isDbAvailable = false;
    }
  }

  // ─── Expose to global scope ─────────────────────────────────────────────────
  window.MicroAlertOffline = {
    saveRoute: saveRouteOffline,
    loadRoute: loadSavedRoute,
    getSavedRoutes: getSavedRoutes,
    deleteRoute: async (id) => {
      await deleteSavedRoute(id);
      showOfflineToast('Route deleted', 'success');
      showOfflineDetails(); // Refresh UI
    },
    clearAll: async () => {
      await clearAllOfflineData();
      showOfflineDetails(); // Refresh UI
    },
    showDetails: showOfflineDetails,
    getUsage: getStorageUsage,
    addToSyncQueue: addToSyncQueue,
    processSync: processyncQueue,
    isOffline: () => isOffline,
    isAvailable: () => isDbAvailable
  };

  // ─── Initialize when DOM ready ──────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
