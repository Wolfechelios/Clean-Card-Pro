// CleanCards Service Worker — network-first for navigations, cache-first for assets
const CACHE_NAME = "cleancards-v1";
const ASSET_CACHE = "cleancards-assets-v1";

// Assets to pre-cache on install
const PRECACHE = ["/offline.html"];

// Install — cache offline fallback
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  // Activate immediately when skipWaiting is called
});

// Listen for skipWaiting message from the client
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Activate — clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== ASSET_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  // Take control of all clients immediately
  self.clients.claim();
});

// Fetch handler
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache OAuth redirects
  if (url.pathname.startsWith("/~oauth")) return;

  // Never cache Supabase API calls
  if (url.hostname.includes("supabase")) return;

  // Navigation requests — network first, offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html"))
    );
    return;
  }

  // Static assets — cache first
  const isAsset =
    /\.(js|css|png|jpg|jpeg|webp|svg|woff2?|wasm|onnx)$/i.test(url.pathname);

  if (isAsset) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, clone));
            }
            return response;
          })
      )
    );
    return;
  }
});
