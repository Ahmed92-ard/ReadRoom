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

// ── Web Push Notifications — Phase 1 Isolated Layer ────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) {
    log('Push event received with no payload');
    return;
  }

  try {
    const payload = event.data.json();
    const title = payload.title || 'ReadRoom';
    const options = {
      body: payload.body || '',
      icon: payload.icon || '/icons/app_icon_192.png',
      badge: payload.badge || '/icons/app_icon_192.png',
      data: payload.data || {},
      vibrate: payload.vibrate || [100, 50, 100],
      actions: payload.actions || [],
      tag: payload.tag || (payload.data && payload.data.roomId ? `room-${payload.data.roomId}` : undefined),
      renotify: true,
    };

    event.waitUntil(
      self.registration.showNotification(title, options)
    );
  } catch (err) {
    log('Failed to parse incoming push event:', err);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action;
  const payloadData = event.notification.data || {};
  
  // Resolve relative path to a fully-qualified absolute URL. 
  // This is required for the mobile/desktop OS (e.g. Brave Android) to intercept 
  // the navigation intent and direct it to the installed standalone PWA app window.
  const urlToOpen = new URL(payloadData.url || '/', self.location.origin).href;
  const roomId = payloadData.roomId;
  const isCall = payloadData.isCall || action === 'join';

  if (action === 'decline') {
    log('Call invitation declined');
    return;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // 1. Try to find and reuse an existing open window of the application
      for (let client of windowClients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin) {
          return client.focus().then((focusedClient) => {
            // Post notification event internally to prevent full-page reload
            focusedClient.postMessage({
              type: 'NOTIFICATION_ROUTE',
              url: urlToOpen,
              roomId: roomId,
              isCall: !!isCall,
            });

            // Only trigger a browser navigation if they aren't already on the correct channel/room page
            if (roomId && !clientUrl.pathname.includes(roomId)) {
              return focusedClient.navigate(urlToOpen);
            }
          });
        }
      }

      // 2. If no window is open, launch a new one
      return self.clients.openWindow(urlToOpen).then((newClient) => {
        if (newClient && roomId) {
          // A brief delay to let the single page app boot before sending the message
          setTimeout(() => {
            newClient.postMessage({
              type: 'NOTIFICATION_ROUTE',
              url: urlToOpen,
              roomId: roomId,
              isCall: !!isCall,
            });
          }, 3000);
        }
      });
    })
  );
});

