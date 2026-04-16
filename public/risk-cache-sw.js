// ─── Risk Cache Service Worker — Feature F ──────────────────────────────────────
// Cache-first for risk data, network-first for everything else.
// Zero impact on existing code.

const CACHE_NAME = 'risk-data-v1';
const STATIC_CACHE = 'static-assets-v1';

// Static assets to pre-cache (existing files only)
const STATIC_ASSETS = [
  '/',
  '/css/style.css',
  '/js/map.js',
  '/js/voice.js',
  '/js/chat.js',
  '/js/prediction-overlay.js',
  '/js/gamification-panel.js',
  '/js/offlineRiskManager.js'
];

// ─── INSTALL: Pre-cache static assets ───────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        // Pre-cache static assets individually (don't fail on missing files)
        return Promise.allSettled(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(err => {
              console.warn(`SW: Failed to cache ${url}:`, err.message);
            })
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ─── ACTIVATE: Clear old caches, claim clients ──────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keyList => {
        return Promise.all(
          keyList.map(key => {
            if (key !== CACHE_NAME && key !== STATIC_CACHE) {
              console.log('SW: Removing old cache:', key);
              return caches.delete(key);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

// ─── FETCH: Intercept risk/prediction API calls ─────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Only intercept risk and prediction API calls
  if (url.includes('/api/risks') || url.includes('/api/prediction')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Clone and cache the fresh response
          const responseClone = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseClone);
            })
            .catch(err => console.warn('SW: Cache put failed:', err.message));
          return response;
        })
        .catch(() => {
          // Offline: serve from cache
          return caches.match(event.request)
            .then(cachedResponse => {
              if (cachedResponse) {
                return cachedResponse;
              }
              // Return an empty success response if nothing cached
              return new Response(
                JSON.stringify({ success: true, data: [], offline: true, message: 'No cached data available' }),
                { headers: { 'Content-Type': 'application/json' } }
              );
            });
        })
    );
    return;
  }

  // Everything else: network-first with static cache fallback
  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request))
    );
  }
});

// ─── Message handler for cache management ───────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_RISK_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0]?.postMessage({ success: true });
    });
  }

  if (event.data && event.data.type === 'GET_CACHE_SIZE') {
    caches.open(CACHE_NAME).then(cache => {
      cache.keys().then(keys => {
        event.ports[0]?.postMessage({ size: keys.length });
      });
    });
  }
});
