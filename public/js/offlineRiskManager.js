// ─── Offline Risk Manager — Feature F ───────────────────────────────────────────
// IndexedDB layer for offline risk data persistence, sync queue, and storage management.
// Enhanced with area-based risk map downloads, route snapshots, and batch sync.
// Zero impact on existing code.

(function () {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────────
  const DB_NAME = 'RiskMapDB';
  const DB_VERSION = 2;
  const STORE_ROUTES = 'routes';
  const STORE_RISK_MAPS = 'risk_maps';
  const STORE_SYNC_QUEUE = 'sync_queue';
  const MAX_STORAGE_MB = 50;
  const ROUTE_EXPIRY_HOURS = 24;
  const MAX_SYNC_RETRIES = 3;
  const SYNC_RETRY_DELAY_MS = 30000;
  const AUTO_SAVE_INTERVAL_MS = 10 * 60 * 1000; // 10 min

  // ─── State ──────────────────────────────────────────────────────────────────
  let db = null;
  let isOffline = false;
  let isDbAvailable = false;
  let isSyncing = false;
  let lastUserLat = null;
  let lastUserLng = null;

  // ─── LZString Compression (minimal inline implementation) ─────────────────
  const LZString = {
    compress: function (input) {
      if (!input) return '';
      try { return btoa(encodeURIComponent(input)); }
      catch (e) { return input; }
    },
    decompress: function (input) {
      if (!input) return '';
      try { return decodeURIComponent(atob(input)); }
      catch (e) { return input; }
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

        // Risk maps store (area-based snapshots)
        if (!database.objectStoreNames.contains(STORE_RISK_MAPS)) {
          const mapStore = database.createObjectStore(STORE_RISK_MAPS, { keyPath: 'area_id' });
          mapStore.createIndex('expires_at', 'expires_at', { unique: false });
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

  // ═══════════════════════════════════════════════════════════════════════════
  // AREA-BASED RISK MAP DOWNLOAD
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Download Risk Map for Current Area ────────────────────────────────────
  async function downloadRiskMap(lat, lng, radiusKm = 5, name = null) {
    if (!isDbAvailable) {
      showOfflineToast('Offline mode not supported on this device', 'error');
      return false;
    }

    try {
      showOfflineToast('📡 Downloading risk map...', 'info');
      updateDownloadButton('downloading');

      const res = await fetch(
        `/api/offline/risk-map?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`
      );
      const json = await res.json();

      if (!json.success || !json.data) {
        throw new Error(json.error || 'Failed to download risk map');
      }

      const riskMap = json.data;
      const areaId = `area_${lat.toFixed(3)}_${lng.toFixed(3)}_${radiusKm}`;

      // Store in IndexedDB for offline use
      const mapData = {
        area_id: areaId,
        name: name || `Area around ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        center: riskMap.center,
        radiusKm: riskMap.radiusKm,
        stats: riskMap.stats,
        risks: riskMap.risks,
        hazards: riskMap.hazards,
        hotZones: riskMap.hotZones,
        downloaded_at: new Date().toISOString(),
        expires_at: riskMap.expiresAt,
        compressed: LZString.compress(JSON.stringify({
          risks: riskMap.risks,
          hazards: riskMap.hazards,
          hotZones: riskMap.hotZones
        }))
      };

      // Check storage quota
      const sizeBytes = new Blob([JSON.stringify(mapData)]).size;
      const sizeMB = sizeBytes / (1024 * 1024);
      const currentUsage = await getStorageUsage();

      if (currentUsage + sizeMB > MAX_STORAGE_MB) {
        await removeOldestMap();
        showOfflineToast('Storage full — oldest map removed', 'warning');
      }

      await dbPut(STORE_RISK_MAPS, mapData);

      // ─── Trigger file download to user's system ──────────────────────
      const downloadPayload = {
        _meta: {
          app: 'MicroAlert',
          type: 'offline_risk_map',
          version: 1,
          generatedAt: riskMap.generatedAt,
          expiresAt: riskMap.expiresAt,
          center: riskMap.center,
          radiusKm: riskMap.radiusKm
        },
        stats: riskMap.stats,
        risks: riskMap.risks,
        hazards: riskMap.hazards,
        hotZones: riskMap.hotZones
      };

      const blob = new Blob(
        [JSON.stringify(downloadPayload, null, 2)],
        { type: 'application/json' }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      a.download = `microalert-risk-map_${lat.toFixed(3)}_${lng.toFixed(3)}_${timestamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const riskCount = riskMap.risks.length;
      const hotCount = riskMap.hotZones.length;
      showOfflineToast(
        `✅ Risk map downloaded — ${riskCount} risks, ${hotCount} hot zones`,
        'success'
      );
      updateDownloadButton('saved');

      return true;
    } catch (err) {
      console.error('Risk map download failed:', err);
      showOfflineToast('❌ Download failed — ' + err.message, 'error');
      updateDownloadButton('error');
      return false;
    }
  }

  // ─── Download Current Location's Risk Map ──────────────────────────────────
  async function downloadCurrentAreaRiskMap() {
    // Try stored lat/lng first
    if (lastUserLat && lastUserLng) {
      return downloadRiskMap(lastUserLat, lastUserLng, 5, 'My Current Area');
    }

    // Try getting from the Leaflet map center
    if (window.map && typeof window.map.getCenter === 'function') {
      const center = window.map.getCenter();
      lastUserLat = center.lat;
      lastUserLng = center.lng;
      return downloadRiskMap(lastUserLat, lastUserLng, 5, 'Current Map View');
    }

    // Try geolocation
    if (navigator.geolocation) {
      return new Promise((resolve) => {
        showOfflineToast('📍 Getting your location...', 'info');
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            lastUserLat = pos.coords.latitude;
            lastUserLng = pos.coords.longitude;
            downloadRiskMap(lastUserLat, lastUserLng, 5, 'My Current Area')
              .then(resolve);
          },
          () => {
            // Fallback to default Chennai center
            lastUserLat = 13.0827;
            lastUserLng = 80.2707;
            showOfflineToast('📍 Using default area (Chennai)', 'info');
            downloadRiskMap(lastUserLat, lastUserLng, 5, 'Chennai Area')
              .then(resolve);
          },
          { enableHighAccuracy: false, timeout: 5000 }
        );
      });
    }

    // Final fallback
    return downloadRiskMap(13.0827, 80.2707, 5, 'Chennai Area');
  }

  // ─── Get Cached Risk Map for a Location ────────────────────────────────────
  async function getCachedRiskMap(lat, lng) {
    if (!isDbAvailable) return null;

    try {
      const maps = await dbGetAll(STORE_RISK_MAPS);
      const now = Date.now();

      for (const map of maps) {
        // Check if expired
        if (new Date(map.expires_at).getTime() < now) {
          await dbDelete(STORE_RISK_MAPS, map.area_id);
          continue;
        }

        // Check if location is within this map's coverage
        const dist = haversine(lat, lng, map.center.lat, map.center.lng);
        if (dist <= map.radiusKm) {
          return map;
        }
      }

      return null;
    } catch (err) {
      return null;
    }
  }

  // ─── Get All Saved Risk Maps ───────────────────────────────────────────────
  async function getSavedMaps() {
    if (!isDbAvailable) return [];
    try {
      const maps = await dbGetAll(STORE_RISK_MAPS);
      const now = Date.now();
      const valid = [];
      for (const map of maps) {
        if (new Date(map.expires_at).getTime() < now) {
          await dbDelete(STORE_RISK_MAPS, map.area_id);
        } else {
          valid.push(map);
        }
      }
      return valid;
    } catch (err) { return []; }
  }

  async function removeOldestMap() {
    try {
      const maps = await dbGetAll(STORE_RISK_MAPS);
      if (maps.length === 0) return;
      maps.sort((a, b) => new Date(a.downloaded_at) - new Date(b.downloaded_at));
      await dbDelete(STORE_RISK_MAPS, maps[0].area_id);
    } catch (e) { /* silent */ }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ROUTE-BASED OFFLINE DATA
  // ═══════════════════════════════════════════════════════════════════════════

  async function saveRouteOffline(routeId, name, polyline) {
    if (!isDbAvailable) {
      showOfflineToast('Offline mode not supported on this device', 'error');
      return false;
    }

    try {
      showOfflineToast('💾 Saving route safety data...', 'info');

      // Use the new route snapshot endpoint if we have start/end
      let riskMarkers = [];
      let predictionScores = [];
      let routeStats = {};

      if (polyline) {
        const parts = polyline.split(';');
        if (parts.length >= 2) {
          const [sLat, sLng] = parts[0].split(',');
          const [eLat, eLng] = parts[parts.length - 1].split(',');

          try {
            const snapRes = await fetch(
              `/api/offline/route-snapshot?startLat=${sLat}&startLng=${sLng}&endLat=${eLat}&endLng=${eLng}`
            );
            const snapJson = await snapRes.json();
            if (snapJson.success && snapJson.data) {
              riskMarkers = snapJson.data.risks || [];
              routeStats = snapJson.data.stats || {};
            }
          } catch (e) { /* fallback below */ }
        }
      }

      // Fallback: fetch from generic risk API
      if (riskMarkers.length === 0) {
        try {
          const riskRes = await fetch('/api/risks');
          const riskJson = await riskRes.json();
          if (riskJson.success) {
            riskMarkers = riskJson.data.map(r => ({
              lat: r.lat, lng: r.lng,
              type: r.type,
              severity: r.severity,
              desc: r.description || '',
              road: r.roadName || '',
              landmark: r.landmark || ''
            }));
          }
        } catch (e) { /* empty markers */ }
      }

      // Fetch prediction scores
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
              score: d.score || d.averageRiskScore
            }));
          } else if (predJson.data.segments) {
            predictionScores = predJson.data.segments.map(s => ({
              lat: s.lat, lng: s.lng,
              score: s.score
            }));
          }
        }
      } catch (e) { /* empty predictions */ }

      const routeData = {
        route_id: routeId,
        name: name || `Route ${routeId}`,
        polyline: polyline || '',
        last_synced: new Date().toISOString(),
        risk_markers: riskMarkers,
        prediction_scores: predictionScores,
        stats: routeStats,
        compressed: LZString.compress(JSON.stringify({ riskMarkers, predictionScores }))
      };

      // Check storage quota
      const sizeBytes = new Blob([JSON.stringify(routeData)]).size;
      const sizeMB = sizeBytes / (1024 * 1024);
      const currentUsage = await getStorageUsage();

      if (currentUsage + sizeMB > MAX_STORAGE_MB) {
        await removeOldestRoute();
        showOfflineToast('Storage almost full — oldest route removed', 'warning');
      }

      await dbPut(STORE_ROUTES, routeData);
      showOfflineToast(`✅ Route saved — ${riskMarkers.length} risk alerts available offline`, 'success');
      updateSaveButton(routeId, 'saved');
      return true;
    } catch (err) {
      console.error('Save offline failed:', err);
      showOfflineToast('Failed to save route offline', 'error');
      return false;
    }
  }

  async function loadSavedRoute(routeId) {
    if (!isDbAvailable) return null;
    try {
      const route = await dbGet(STORE_ROUTES, routeId);
      if (!route) return null;
      const synced = new Date(route.last_synced);
      const hoursSinceSynced = (Date.now() - synced.getTime()) / (1000 * 60 * 60);
      if (hoursSinceSynced > ROUTE_EXPIRY_HOURS) {
        await dbDelete(STORE_ROUTES, routeId);
        return null;
      }
      return route;
    } catch (err) { return null; }
  }

  async function getSavedRoutes() {
    if (!isDbAvailable) return [];
    try {
      const routes = await dbGetAll(STORE_ROUTES);
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
    } catch (err) { return []; }
  }

  async function deleteSavedRoute(routeId) {
    if (!isDbAvailable) return false;
    try {
      await dbDelete(STORE_ROUTES, routeId);
      return true;
    } catch (err) { return false; }
  }

  async function removeOldestRoute() {
    try {
      const routes = await dbGetAll(STORE_ROUTES);
      if (routes.length === 0) return;
      routes.sort((a, b) => new Date(a.last_synced) - new Date(b.last_synced));
      await dbDelete(STORE_ROUTES, routes[0].route_id);
    } catch (err) { /* silent */ }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SYNC QUEUE — Offline Report Buffering
  // ═══════════════════════════════════════════════════════════════════════════

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
      updateSyncBadge();
      showOfflineToast('📝 Report queued — will upload when back online', 'info');
    } catch (err) {
      console.warn('Failed to add to sync queue:', err);
    }
  }

  async function processSyncQueue() {
    if (!isDbAvailable || isOffline || isSyncing) return;

    isSyncing = true;
    try {
      const items = await dbGetAll(STORE_SYNC_QUEUE);
      if (items.length === 0) { isSyncing = false; return; }

      showOfflineToast(`📤 Syncing ${items.length} queued report(s)...`, 'info');

      // Batch sync via the new endpoint
      const reports = items
        .filter(item => item.action === 'report_risk')
        .map(item => ({ ...item.payload, clientId: item.id }));

      if (reports.length > 0) {
        try {
          const res = await fetch('/api/offline/sync-reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reports })
          });

          if (res.ok) {
            const json = await res.json();
            if (json.success) {
              // Remove successfully synced items
              for (const result of json.data.results) {
                if (result.status === 'created') {
                  await dbDelete(STORE_SYNC_QUEUE, result.clientId);
                }
              }
              showOfflineToast(`✅ ${json.data.created} report(s) synced!`, 'success');
            }
          }
        } catch (e) {
          console.warn('Batch sync failed, trying individual:', e);
        }
      }

      // Process remaining items individually
      const remaining = await dbGetAll(STORE_SYNC_QUEUE);
      for (const item of remaining) {
        try {
          let endpoint;
          switch (item.action) {
            case 'report_risk': endpoint = '/api/risks/report'; break;
            case 'confirm_report': endpoint = '/api/game/log-report'; break;
            case 'photo_hazard': endpoint = '/api/llm/analyze-photo'; break;
            default: endpoint = '/api/risks/report';
          }

          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.payload)
          });

          if (res.ok) {
            await dbDelete(STORE_SYNC_QUEUE, item.id);
          } else {
            throw new Error(`HTTP ${res.status}`);
          }
        } catch (err) {
          item.retry_count++;
          if (item.retry_count >= MAX_SYNC_RETRIES) {
            showOfflineToast('⚠️ Report upload failed after retries', 'error');
            await dbDelete(STORE_SYNC_QUEUE, item.id);
          } else {
            await dbPut(STORE_SYNC_QUEUE, item);
          }
        }
      }

      updateSyncBadge();
    } catch (err) {
      console.warn('Sync queue processing failed:', err);
    } finally {
      isSyncing = false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STORAGE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  async function getStorageUsage() {
    if (!isDbAvailable) return 0;
    try {
      const routes = await dbGetAll(STORE_ROUTES);
      const maps = await dbGetAll(STORE_RISK_MAPS);
      const queue = await dbGetAll(STORE_SYNC_QUEUE);
      const all = [...routes, ...maps, ...queue];
      const totalBytes = all.reduce((sum, r) => sum + new Blob([JSON.stringify(r)]).size, 0);
      return totalBytes / (1024 * 1024);
    } catch (err) { return 0; }
  }

  async function clearAllOfflineData() {
    if (!isDbAvailable) return false;
    try {
      await dbClear(STORE_ROUTES);
      await dbClear(STORE_RISK_MAPS);
      await dbClear(STORE_SYNC_QUEUE);
      showOfflineToast('🗑️ All offline data cleared', 'success');
      updateSyncBadge();
      return true;
    } catch (err) { return false; }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // OFFLINE DETECTION & AUTO-SAVE
  // ═══════════════════════════════════════════════════════════════════════════

  function setupOfflineDetection() {
    window.addEventListener('offline', () => {
      isOffline = true;
      showOfflineBanner();
      // Immediately try to serve cached data
      loadCachedRisksOntoMap();
    });

    window.addEventListener('online', () => {
      isOffline = false;
      hideOfflineBanner();
      processSyncQueue();
      // Refresh risk maps in background
      autoRefreshMaps();
    });

    isOffline = !navigator.onLine;
    if (isOffline) showOfflineBanner();
  }

  // Track user position for auto-saving
  function setupLocationTracking() {
    if (!navigator.geolocation) return;

    navigator.geolocation.watchPosition(
      (pos) => {
        lastUserLat = pos.coords.latitude;
        lastUserLng = pos.coords.longitude;
      },
      () => { /* silent */ },
      { enableHighAccuracy: false, maximumAge: 60000 }
    );
  }

  // Auto-refresh cached maps when online
  async function autoRefreshMaps() {
    if (isOffline || !isDbAvailable) return;
    try {
      const maps = await dbGetAll(STORE_RISK_MAPS);
      for (const map of maps) {
        const age = (Date.now() - new Date(map.downloaded_at).getTime()) / (1000 * 60 * 60);
        if (age > 12) {
          // Refresh maps older than 12 hours
          await downloadRiskMap(map.center.lat, map.center.lng, map.radiusKm, map.name);
        }
      }
    } catch (e) { /* silent */ }
  }

  // ─── Load cached risks onto map when offline ───────────────────────────────
  async function loadCachedRisksOntoMap() {
    if (!isDbAvailable) return;

    try {
      // Try area-based maps first
      const maps = await getSavedMaps();
      let offlineRisks = [];

      for (const map of maps) {
        if (map.risks) {
          offlineRisks = offlineRisks.concat(map.risks);
        }
      }

      // Also check saved routes
      const routes = await getSavedRoutes();
      for (const route of routes) {
        if (route.risk_markers) {
          offlineRisks = offlineRisks.concat(route.risk_markers);
        }
      }

      if (offlineRisks.length > 0 && window.L && window.map) {
        // Create offline risk layer
        let offlineLayer = window._offlineRiskLayer;
        if (offlineLayer) {
          offlineLayer.clearLayers();
        } else {
          offlineLayer = L.layerGroup().addTo(window.map);
          window._offlineRiskLayer = offlineLayer;
        }

        const severityColors = {
          5: '#ef4444', 4: '#f97316', 3: '#eab308', 2: '#84cc16', 1: '#10b981'
        };

        offlineRisks.forEach(r => {
          const color = severityColors[r.severity] || '#eab308';
          const marker = L.circleMarker([r.lat, r.lng], {
            radius: 6 + (r.severity || 3),
            fillColor: color,
            fillOpacity: 0.6,
            color: color,
            weight: 1,
            opacity: 0.8
          });

          marker.bindPopup(`
            <div style="font-size:12px;">
              <strong>⚠️ ${(r.type || r.road || 'Risk').replace(/_/g, ' ')}</strong><br>
              ${r.desc || r.description || ''}
              ${r.road || r.roadName ? `<br>📍 ${r.road || r.roadName}` : ''}
              <br><em style="color:#999;font-size:10px;">📡 Offline cache</em>
            </div>
          `);

          offlineLayer.addLayer(marker);
        });

        showOfflineToast(`📡 Showing ${offlineRisks.length} cached risks`, 'info');
      }
    } catch (err) {
      console.warn('Error loading cached risks:', err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UI COMPONENTS
  // ═══════════════════════════════════════════════════════════════════════════

  function showOfflineBanner() {
    let banner = document.getElementById('offlineBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'offlineBanner';
      banner.className = 'offline-banner';
      banner.innerHTML = `
        <div class="offline-banner-content">
          <span class="offline-banner-icon">📡</span>
          <span class="offline-banner-text">You're offline — showing cached risk data</span>
          <span class="offline-sync-badge" id="offlineSyncBadge" style="display:none;"></span>
          <button class="offline-banner-details" onclick="window.MicroAlertOffline.showDetails()">Details</button>
        </div>
      `;
      document.body.appendChild(banner);
    }
    banner.classList.add('visible');
    updateSyncBadge();
  }

  function hideOfflineBanner() {
    const banner = document.getElementById('offlineBanner');
    if (banner) banner.classList.remove('visible');
  }

  async function updateSyncBadge() {
    if (!isDbAvailable) return;
    try {
      const items = await dbGetAll(STORE_SYNC_QUEUE);
      const badge = document.getElementById('offlineSyncBadge');
      if (badge) {
        if (items.length > 0) {
          badge.textContent = `${items.length} pending`;
          badge.style.display = 'inline-block';
        } else {
          badge.style.display = 'none';
        }
      }
    } catch (e) { /* silent */ }
  }

  // ─── Download Button in Map Controls ───────────────────────────────────────
  function createDownloadButton() {
    const mapContainer = document.querySelector('.map-container');
    if (!mapContainer) return;

    const btn = document.createElement('button');
    btn.id = 'offlineDownloadBtn';
    btn.className = 'offline-download-fab';
    btn.innerHTML = '📡';
    btn.title = 'Download Risk Map for Offline Use';
    btn.onclick = downloadCurrentAreaRiskMap;

    mapContainer.appendChild(btn);
  }

  function updateDownloadButton(state) {
    const btn = document.getElementById('offlineDownloadBtn');
    if (!btn) return;

    if (state === 'downloading') {
      btn.innerHTML = '⏳';
      btn.classList.add('downloading');
    } else if (state === 'saved') {
      btn.innerHTML = '✅';
      btn.classList.remove('downloading');
      setTimeout(() => { btn.innerHTML = '📡'; }, 3000);
    } else if (state === 'error') {
      btn.innerHTML = '❌';
      btn.classList.remove('downloading');
      setTimeout(() => { btn.innerHTML = '📡'; }, 3000);
    }
  }

  // ─── Offline Details Panel ──────────────────────────────────────────────────
  async function showOfflineDetails() {
    const routes = await getSavedRoutes();
    const maps = await getSavedMaps();
    const usage = await getStorageUsage();
    const syncItems = isDbAvailable ? await dbGetAll(STORE_SYNC_QUEUE) : [];
    const usagePercent = Math.min((usage / MAX_STORAGE_MB) * 100, 100);

    let panel = document.getElementById('offlineDetailsPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'offlineDetailsPanel';
      panel.className = 'offline-details-panel';
      document.body.appendChild(panel);
    }

    panel.innerHTML = `
      <div class="offline-details-header">
        <h3>📡 Offline Risk Cache</h3>
        <button class="offline-details-close" onclick="document.getElementById('offlineDetailsPanel').classList.remove('visible')">✕</button>
      </div>
      <div class="offline-details-body">
        <div class="offline-stat">
          <span>Connection Status</span>
          <strong style="color:${isOffline ? '#ef4444' : '#10b981'}">${isOffline ? '🔴 Offline' : '🟢 Online'}</strong>
        </div>
        <div class="offline-stat">
          <span>Storage Used</span>
          <strong>${usage.toFixed(1)} MB / ${MAX_STORAGE_MB} MB</strong>
        </div>
        <div class="offline-storage-bar">
          <div class="offline-storage-fill" style="width:${usagePercent}%;background:${usagePercent > 80 ? '#ef4444' : usagePercent > 50 ? '#eab308' : '#10b981'}"></div>
        </div>
        <div class="offline-stat">
          <span>Pending Reports</span>
          <strong>${syncItems.length}${syncItems.length > 0 ? ' ⏳' : ''}</strong>
        </div>

        ${maps.length > 0 ? `
        <div class="offline-section-title">📍 Saved Risk Maps (${maps.length})</div>
        <div class="offline-routes-list">
          ${maps.map(m => {
            const age = ((Date.now() - new Date(m.downloaded_at).getTime()) / (1000 * 60 * 60)).toFixed(1);
            const riskCount = m.risks?.length || 0;
            const hotCount = m.hotZones?.length || 0;
            return `
              <div class="offline-route-item">
                <div class="offline-route-info">
                  <div class="offline-route-name">${m.name}</div>
                  <div class="offline-route-meta">${riskCount} risks · ${hotCount} hot zones · ${age}h ago</div>
                </div>
                <button class="offline-route-delete" onclick="window.MicroAlertOffline.deleteMap('${m.area_id}')">🗑️</button>
              </div>
            `;
          }).join('')}
        </div>` : ''}

        ${routes.length > 0 ? `
        <div class="offline-section-title">🛣️ Saved Routes (${routes.length})</div>
        <div class="offline-routes-list">
          ${routes.map(r => {
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
          }).join('')}
        </div>` : ''}

        ${maps.length === 0 && routes.length === 0 ? '<div class="offline-empty">No saved data. Tap 📡 to download your area\'s risk map.</div>' : ''}

        <div style="display:flex;gap:8px;margin-top:14px;">
          <button class="btn btn-secondary" style="flex:1;padding:8px;font-size:11px;border:1px solid var(--border-color);background:var(--bg-input);border-radius:8px;cursor:pointer;font-family:Inter,sans-serif;"
            onclick="window.MicroAlertOffline.downloadArea()">
            📡 Download Current Area
          </button>
          <button class="btn btn-secondary" style="flex:1;padding:8px;font-size:11px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.08);border-radius:8px;cursor:pointer;color:#ef4444;font-family:Inter,sans-serif;"
            onclick="window.MicroAlertOffline.clearAll()">
            🗑️ Clear All
          </button>
        </div>
      </div>
    `;

    panel.classList.add('visible');
  }

  // ─── Save Offline Button (appended to route cards) ──────────────────────────
  function addSaveOfflineButtons() {
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
    if (state === 'saved') {
      btn.innerHTML = '✅ Route Saved for Offline';
      btn.classList.add('saved');
    }
  }

  // ─── Toast Helper ───────────────────────────────────────────────────────────
  function showOfflineToast(message, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type === 'error' ? 'error' : 'success');
      return;
    }
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

  // ─── Haversine Distance (km) ───────────────────────────────────────────────
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
      registerServiceWorker();
      await initDB();
      setupOfflineDetection();
      setupLocationTracking();
      addSaveOfflineButtons();
      createDownloadButton();

      // Clean expired data on startup
      await getSavedMaps();
      await getSavedRoutes();

      console.log('✅ Offline risk manager initialized');
    } catch (err) {
      console.warn('Offline manager init failed (degrading gracefully):', err.message);
      isDbAvailable = false;
    }
  }

  // ─── Expose to global scope ─────────────────────────────────────────────────
  window.MicroAlertOffline = {
    saveRoute: saveRouteOffline,
    loadRoute: loadSavedRoute,
    getSavedRoutes: getSavedRoutes,
    downloadArea: downloadCurrentAreaRiskMap,
    downloadRiskMap: downloadRiskMap,
    getCachedMap: getCachedRiskMap,
    deleteRoute: async (id) => {
      await deleteSavedRoute(id);
      showOfflineToast('Route deleted', 'success');
      showOfflineDetails();
    },
    deleteMap: async (id) => {
      if (isDbAvailable) { await dbDelete(STORE_RISK_MAPS, id); }
      showOfflineToast('Risk map deleted', 'success');
      showOfflineDetails();
    },
    clearAll: async () => {
      await clearAllOfflineData();
      showOfflineDetails();
    },
    showDetails: showOfflineDetails,
    getUsage: getStorageUsage,
    addToSyncQueue: addToSyncQueue,
    processSync: processSyncQueue,
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
