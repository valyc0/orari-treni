const CACHE = 'treni-react-v1';
const STATIC = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Richieste esterne (proxy CORS, CDN): rete diretta, nessun intercetto
  if (url.origin !== location.origin) return;

  // Navigazioni: sempre dalla rete (Next.js gestisce il routing server-side)
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request));
    return;
  }

  // Risorse Next.js (_next/*): sempre dalla rete in dev, cache-first in prod
  if (url.pathname.startsWith('/_next/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // Risorse statiche: cache-first, poi rete con aggiornamento cache
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(resp => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return resp;
      });
    })
  );
});
