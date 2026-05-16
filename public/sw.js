const CACHE_NAME = 'readroom-v4';
const ASSETS = [
  '/manifest.json',
  '/icons/app_icon_192.png',
  '/icons/app_icon_512.png',
  '/icons/app_icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isMutableAppData =
    event.request.mode === 'navigate' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/libraries/') ||
    url.pathname.startsWith('/room/') ||
    url.pathname.includes('/_next/data/');

  if (isMutableAppData) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .catch(() => caches.match(event.request))
        .then((response) => response || Response.error())
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cacheResponse) => {
      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return networkResponse;
        })
        .catch(() => cacheResponse || caches.match('/'));
    })
  );
});
