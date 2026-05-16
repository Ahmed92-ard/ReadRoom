// ReadRoom Service Worker - runtime-v9
//
// This worker is intentionally conservative: navigations, APIs, auth routes,
// and app-shell assets go to the network first so an installed PWA cannot keep
// booting with a mixed old/new Next.js deployment.

const SW_VERSION = 'runtime-v9';
const RUNTIME_CACHE = `readroom-${SW_VERSION}`;
const CACHE_ALLOWLIST = new Set([RUNTIME_CACHE]);

const PRECACHE_ASSETS = [
  '/manifest.json',
  '/icons/app_icon_192.png',
  '/icons/app_icon_512.png',
  '/icons/app_icon.png',
];

function log(...args) {
  // Visible in Application > Service Workers during PWA debugging.
  console.log('[ReadRoom SW]', SW_VERSION, ...args);
}

function offlineResponse(message = 'ReadRoom is offline. Please reconnect and try again.') {
  return new Response(message, {
    status: 503,
    statusText: 'Service Unavailable',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-ReadRoom-SW': SW_VERSION,
    },
  });
}

function canCache(response) {
  return response && response.ok && (response.type === 'basic' || response.type === 'cors');
}

async function putCache(request, response) {
  if (!canCache(response)) return;
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
  } catch (err) {
    log('cache put failed', request.url, err);
  }
}

async function networkFirst(request, fallbackToCache = false) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (request.method === 'GET') await putCache(request, response);
    return response;
  } catch (err) {
    log('network failed', request.url, err);
    if (fallbackToCache) {
      const cached = await caches.match(request).catch(() => undefined);
      if (cached) return cached;
    }
    return offlineResponse();
  }
}

async function cacheFirst(request) {
  try {
    const cached = await caches.match(request);
    if (cached) {
      fetch(request).then((response) => putCache(request, response)).catch((err) => {
        log('background refresh failed', request.url, err);
      });
      return cached;
    }
    return await networkFirst(request, false);
  } catch (err) {
    log('cache-first failed', request.url, err);
    return offlineResponse();
  }
}

self.addEventListener('install', (event) => {
  log('install');
  event.waitUntil(
    caches.open(RUNTIME_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .catch((err) => log('precache failed', err))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  log('activate');
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('readroom-') && !CACHE_ALLOWLIST.has(key))
          .map((key) => {
            log('delete old cache', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') {
    log('skip waiting requested');
    self.skipWaiting();
  }
  if (type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('readroom-')).map((key) => caches.delete(key))
      ))
    );
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  const path = url.pathname;
  const isNavigation = request.mode === 'navigate';
  const isCriticalRuntime =
    path === '/' ||
    path === '/sw.js' ||
    path === '/manifest.json' ||
    path.startsWith('/api/') ||
    path.startsWith('/auth') ||
    path.includes('/_next/data/') ||
    path.startsWith('/_next/webpack-hmr');

  const isImmutableStatic =
    path.startsWith('/_next/static/') ||
    path.startsWith('/icons/');

  event.respondWith((async () => {
    if (isNavigation || isCriticalRuntime) {
      return networkFirst(request, false);
    }

    if (isImmutableStatic) {
      return cacheFirst(request);
    }

    return networkFirst(request, true);
  })().catch((err) => {
    log('unhandled fetch failure', request.url, err);
    return offlineResponse();
  }));
});
