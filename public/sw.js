// ReadRoom Service Worker — v7 (Drive removed, local-only uploads)
// Bump CACHE_NAME whenever the app shell changes to force cache invalidation.
const CACHE_NAME = 'readroom-v7';

const STATIC_ASSETS = [
  '/manifest.json',
  '/icons/app_icon_192.png',
  '/icons/app_icon_512.png',
  '/icons/app_icon.png',
];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => { /* non-fatal: assets may not exist yet */ })
  );
  self.skipWaiting();
});

// ── Activate: purge all old caches ───────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Safe response helpers ─────────────────────────────────────────────────────
// NEVER return undefined from a fetch handler — always return a Response.

function offlineResponse() {
  return new Response('Offline — please check your connection.', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain' },
  });
}

function networkErrorResponse(err) {
  return new Response('Network error: ' + String(err), {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain' },
  });
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // ── Network-only paths (never cache, always fresh) ────────────────────────
  const isNetworkOnly =
    event.request.mode === 'navigate' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/libraries/') ||
    url.pathname.startsWith('/room/') ||
    url.pathname.includes('/_next/data/') ||
    url.pathname.includes('/api/socket');

  if (isNetworkOnly) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((response) => {
          // Always return the network response (even 4xx/5xx)
          return response;
        })
        .catch((err) => {
          // Network failed — try cache for navigate requests, else offline response
          if (event.request.mode === 'navigate') {
            return caches.match(event.request)
              .then((cached) => cached ?? offlineResponse())
              .catch(() => offlineResponse());
          }
          return networkErrorResponse(err);
        })
    );
    return;
  }

  // ── Cache-first with background update for static assets ─────────────────
  // (_next/static/*, icons/*, manifest.json)
  event.respondWith(
    caches.match(event.request)
      .then((cached) => {
        // Kick off a background network fetch to keep cache fresh
        const networkFetch = fetch(event.request)
          .then((response) => {
            if (response && response.ok && response.type === 'basic') {
              const clone = response.clone();
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(event.request, clone))
                .catch(() => {});
            }
            return response;
          })
          .catch(() => null); // background update failure is non-fatal

        // Return cached immediately if available; otherwise wait for network
        if (cached) return cached;

        return networkFetch.then((response) => {
          if (response) return response;
          return offlineResponse();
        });
      })
      .catch((err) => {
        // caches.match itself failed (shouldn't happen, but be safe)
        return fetch(event.request).catch(() => networkErrorResponse(err));
      })
  );
});
