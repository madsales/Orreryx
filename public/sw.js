// Service Worker for OrreryX — Web Push Notifications + Offline Cache
const CACHE_NAME = 'orreryx-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app',
  '/map',
  '/risk-dashboard',
  '/gold-price',
  '/oil-price',
  '/geopolitics-news',
  '/capacitor-init.iife.js',
];

// Install: cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// Fetch: network-first for API, navigation fallback to /app, cache-first for static
self.addEventListener('fetch', event => {
  if (event.request.url.includes('/api/')) {
    // Network first for API calls.
    // Note: In the Capacitor native app, API calls use the monkey-patched window.fetch
    // in offline.ts (Filesystem cache fallback) — this SW branch handles web/PWA context only.
    event.respondWith(
      fetch(event.request).catch(() => new Response(JSON.stringify({ error: 'offline' }), { headers: { 'Content-Type': 'application/json' } }))
    );
    return;
  }
  // Navigation requests — network first, fall back to /app shell when offline
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('/app').then(r => r || new Response('Offline — please reconnect', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        }))
      )
    );
    return;
  }
  // Cache first for static assets
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match('/app')))
  );
});

// Push notification handler
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'OrreryX Alert', body: 'New geopolitical risk update', url: '/' };
  event.waitUntil(
    self.registration.showNotification(data.title || 'OrreryX Intelligence', {
      body: data.body || 'New geopolitical risk update',
      icon: '/icon-192.png',
      badge: '/icon-72.png',
      tag: data.tag || 'orreryx-alert',
      data: { url: data.url || '/risk-dashboard' },
      actions: [
        { action: 'view', title: 'View Dashboard' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    })
  );
});

// Notification click handler
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data?.url || '/risk-dashboard';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes('orreryx.io') && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
