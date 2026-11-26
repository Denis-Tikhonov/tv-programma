const CACHE = 'tv-programma-v1.2.1';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/utils.js',
  './js/db.js',
  './js/epg.js',
  './js/ui.js',
  './js/app.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // CRITICAL: do NOT intercept EPG archives at all.
  // respondWith(fetch()) caused NS_BINDING_ABORTED / stream errors on large .gz files.
  if (
    url.pathname.includes('/epg/') ||
    url.pathname.endsWith('.xml.gz') ||
    url.pathname.endsWith('.xml') ||
    url.search.includes('_t=')
  ) {
    return; // browser handles the request directly
  }

  // Only same-origin app shell
  if (url.origin !== self.location.origin) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
