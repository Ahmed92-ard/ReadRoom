// ReadRoom Service Worker — v5 (canonical schema reset)
// Bump CACHE_NAME whenever the app shell changes to force cache invalidation.
const CACHE_NAME = 'readroom-v5';

const STATIC_ASSETS = [
  '/manifest.json',
  '/icons/app_icon_192.png',
  '/icons/app_icon_512.png',
  '/icons/app_icon.png',
];

// ── Install: pre-cache static shell assets ────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  // Take control immediately — don't wait for old SW to die
  self.skipWaiting();
});

// ── Activate: delete ALL old caches ──────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[sw] deleting old cache:', key);
            return caches.delete(key);
          })
      )
    )
  );
  // Claim all open clients so the new SW takes effect without reload
  self.clients.claim();
});

// ── Fetch: network-first for app routes, cache-first for static assets ────────
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Always go to network for:
  //   - page navigations (HTML)
  //   - API calls
  //   - auth routes
  //   - Next.js data routes
  //   - socket upgrades
  const isNetworkOnly =
    event.request.mode === 'navigate' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/libraries') ||
    url.pathname.startsWith('/room') ||
    url.pathname.includes('/_next/data/') ||
    url.pathname.includes('/api/socket');

  if (isNetworkOnly) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() =>
        // Offline fallback: return cached page if available, else error
        caches.match(event.request).then((r) => r ?? Response.error())
      )
    );
    return;
  }

  // Cache-first with network update for static assets (_next/static, icons, etc.)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => (cached ? null : Response.error()));

      // Return cached immediately if available, update in background
      return cached ?? networkFetch;
    })
  );
});
