/**
 * NEXUS AI — Service Worker v5.0
 * Strategy: Cache-first for static assets, network-first for API calls.
 * Enables offline editing and fast repeat loads.
 */

const CACHE_NAME    = 'nexus-ai-v5';
const API_CACHE     = 'nexus-api-v1';

// Static assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/js/main.js',
  '/js/editor.js',
  '/js/ui.js',
  '/js/ai.js',
  '/js/files.js',
  '/js/storage.js',
  '/js/utils.js',
  '/firebase.js',
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== API_CACHE)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API calls: network-first, no cache
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).catch(() =>
      new Response(JSON.stringify({ success: false, message: 'Offline' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    ));
    return;
  }

  // Firebase: always network
  if (url.hostname.includes('firebase') || url.hostname.includes('gstatic')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Google Fonts / CDN: stale-while-revalidate
  if (url.hostname.includes('fonts.googleapis') ||
      url.hostname.includes('cdnjs.cloudflare')) {
    e.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(e.request).then(cached => {
          const fresh = fetch(e.request).then(r => { cache.put(e.request, r.clone()); return r; });
          return cached || fresh;
        })
      )
    );
    return;
  }

  // App shell: cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, response.clone()));
        }
        return response;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
