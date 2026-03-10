// Clean Cards Service Worker
const CACHE_NAME = "clean-cards-v1";
const PRECACHE_URLS = ["/", "/offline.html"];

// Install: precache shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for navigations, cache-first for assets
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Skip non-GET and cross-origin
  if (request.method !== "GET" || !request.url.startsWith(self.location.origin)) return;

  // Never cache OAuth redirects
  if (new URL(request.url).pathname.startsWith("/~oauth")) return;

  if (request.mode === "navigate") {
    // Network-first for pages
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html"))
    );
  } else {
    // Cache-first for assets
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          // Cache successful responses for static assets
          if (response.ok && (request.url.match(/\.(js|css|png|jpg|jpeg|svg|woff2?|wasm|onnx)$/))) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
  }
});
