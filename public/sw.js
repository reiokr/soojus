// Soojuse service worker: paigaldatav PWA, offline-kest ja push-teavitused.
const CACHE = 'soojus-v2';
const API_CACHE = 'soojus-api-v1';
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE && key !== API_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

const isCacheableApi = pathname =>
  pathname === '/api/status' || pathname === '/api/systems' || pathname === '/api/airobot' ||
  pathname === '/api/luxtronik' || pathname === '/api/location' || pathname === '/api/weather' ||
  pathname === '/api/notifications/settings' || pathname === '/api/notifications/log' ||
  pathname === '/api/push/status' || pathname === '/api/backups' || pathname === '/api/legionella' ||
  pathname === '/api/audio' || pathname.startsWith('/api/devices/') ||
  /^\/api\/systems\/[^/]+\/notifications$/.test(pathname);

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  // Viimased põhiandmed jäävad offline'is kättesaadavaks. Ajalugu, arhiiv, analüüs ja
  // suured failid jäävad võrku, et vahemälu ei paisuks.
  if (url.pathname.startsWith('/api/')) {
    if (!isCacheableApi(url.pathname)) return;
    event.respondWith(fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(API_CACHE).then(cache => cache.put(request, copy)); }
      return response;
    }).catch(async () => (await caches.match(request)) || new Response(JSON.stringify({ error: 'Offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put('/index.html', copy));
      return response;
    }).catch(() => caches.match('/index.html')));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
    return response;
  })));
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* tavaline tekst */ }
  const title = data.title || 'Soojus';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag,
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const client = clients.find(item => item.url.startsWith(location.origin));
    if (client) { client.focus(); if ('navigate' in client) client.navigate(url); return; }
    return self.clients.openWindow(url);
  }));
});
