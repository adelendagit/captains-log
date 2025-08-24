const CACHE_NAME = 'where-is-v1';
const URLS_TO_CACHE = [
  '/',
  '/css/captains-log.css',
  '/js/captains-log.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((resp) => resp || fetch(event.request))
  );
});
