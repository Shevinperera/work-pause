// Service Worker for Work Hours · Post Production.
// Enables PWA install (desktop & mobile) and brings the app tab into focus
// when an employee clicks a browser reminder notification.

const CACHE_NAME = 'work-hours-shell-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Network-first for same-origin static assets so deployments are never stale;
// cache is used strictly as an offline fallback.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      throw err;
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
        return client.focus();
      }
    }
    if (self.clients.openWindow) {
      return self.clients.openWindow('./');
    }
  })());
});
