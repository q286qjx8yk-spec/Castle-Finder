// Castle Finder -- sw.js
// Minimal service worker for offline/installable use. The app shell
// (HTML/CSS/JS/manifest/icons) and the castle data use network-first (so
// active development changes and fresh data are always picked up when
// online, with the cache only as an offline fallback). Third-party assets
// (CDN libraries, map tiles) use cache-first since those URLs are already
// version-pinned and benefit from caching.

var CACHE_NAME = "castlefinder-v2";

var APP_SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "trip.js",
  "manifest.json",
  "data/castles.json",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

var NETWORK_FIRST_PATHS = [
  "index.html",
  "styles.css",
  "app.js",
  "trip.js",
  "manifest.json",
  "data/castles.json",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

function isNetworkFirst(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname === "/" || url.pathname.endsWith("/")) return true;
  return NETWORK_FIRST_PATHS.some(function (path) {
    return url.pathname.indexOf(path) !== -1;
  });
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function (name) {
            return name !== CACHE_NAME;
          })
          .map(function (name) {
            return caches.delete(name);
          })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var url = new URL(request.url);

  // Network-first for the app shell and data: always try the network so
  // edits/updates are picked up immediately, falling back to the cache
  // only when offline.
  if (isNetworkFirst(url)) {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          var responseClone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(function () {
          return caches.match(request);
        })
    );
    return;
  }

  // Cache-first for everything else (CDN libraries, map tiles) -- those
  // URLs are already version-pinned or slow-changing, so caching them is
  // a pure performance/offline win.
  event.respondWith(
    caches.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        var responseClone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(request, responseClone);
        });
        return response;
      });
    })
  );
});
