// Orrery Service Worker — v1.0
// Enables PWA install (Add to Home Screen / desktop widget)
// Caches static assets for offline shell
// Sends browser notifications when new events arrive (via postMessage from app)

const CACHE    = 'orrery-v1';
const PRECACHE = ['/app', '/app.html', '/'];

// ── INSTALL ────────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──────────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH — network first, cache fallback for navigation ─────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API calls — always network, never cache
  if (url.pathname.startsWith('/api/')) return;

  // Navigation (HTML pages) — network first
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/app.html'))
    );
    return;
  }

  // Static assets — cache first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

// ── PUSH NOTIFICATIONS (from app via postMessage) ─────────────────────────────
// The app calls: navigator.serviceWorker.controller.postMessage({ type:'NEW_EVENT', event:{...} })
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'NEW_EVENT') return;
  const ev = e.data.event || {};
  const body = ev.txt ? ev.txt.substring(0, 100) + '…' : 'A new geopolitical event has been detected.';

  self.registration.showNotification('Orrery — ' + (ev.catLabel || 'New Event'), {
    body:    body,
    icon:    '/icon-192.png',
    badge:   '/icon-192.png',
    tag:     'orrery-event-' + (ev.id || Date.now()),
    renotify: false,
    data:    { url: '/app' },
    actions: [
      { action: 'open',    title: 'View Intel' },
      { action: 'dismiss', title: 'Dismiss' }
    ],
    vibrate: [200, 100, 200]
  }).catch(() => {}); // Silently fail if notifications not supported
});

// ── NOTIFICATION CLICK ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('/app') && 'focus' in c) return c.focus();
      }
      return clients.openWindow('/app');
    })
  );
});
