/* E-ZONE Therapists service worker.
 * Strategy: NETWORK-FIRST. This is a live-data app, so we never want to serve a
 * stale API response or a stale app.js. We only fall back to cache when the
 * network is unavailable, so an installed app still opens offline (read-only of
 * whatever was last seen). API calls are never cached.
 */
var CACHE = 'ezone-therapists-v18';
var SHELL = [
  './',
  './index.html',
  './guide.html',
  './manifest.webmanifest',
  './renewal.js',
  './icon-v2-192.png',
  './icon-v2-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.pathname.indexOf('/api/') === 0) return;

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok && url.origin === self.location.origin) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match('./index.html'); });
    })
  );
});
