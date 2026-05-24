const CACHE_NAME = "note-pwa-v16";

const BASE = new URL("./", self.location).href;

const APP_SHELL = [
  new URL("index.html", BASE).href,
  new URL("styles.css", BASE).href,
  new URL("db.js", BASE).href,
  new URL("sync.js", BASE).href,
  new URL("editor.js", BASE).href,
  new URL("themes.js", BASE).href,
  new URL("share.js", BASE).href,
  new URL("app.js", BASE).href,
  new URL("manifest.webmanifest", BASE).href,
  new URL("icons/icon-192.png?v=1", BASE).href,
  new URL("icons/icon-512.png?v=1", BASE).href,
  new URL("icons/maskable-512.png?v=1", BASE).href
];

const INDEX_HTML = new URL("index.html", BASE).href;

function isAppAsset(url) {
  return url.origin === self.location.origin && /\.(js|css|html|webmanifest)(\?|$)/.test(url.pathname + url.search);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(INDEX_HTML)));
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isAppAsset(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const refresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || refresh;
    })
  );
});
