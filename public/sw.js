// CleanCards Service Worker — network-first for navigations, cache-first for assets
// Preview safety: become passive inside iframes / Lovable preview hosts
const IS_PREVIEW = (() => {
  try { return self.location.hostname.includes("id-preview--") || self.location.hostname.includes("lovableproject.com"); } catch { return false; }
})();

const CACHE_NAME = "cleancards-v2";
const ASSET_CACHE = "cleancards-assets-v2";
const PRECACHE = ["/offline.html"];

// Install
self.addEventListener("install", (event) => {
  if (IS_PREVIEW) { self.skipWaiting(); return; }
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
});

// Message
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== ASSET_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — passive in preview
self.addEventListener("fetch", (event) => {
  if (IS_PREVIEW) return; // let browser handle everything

  const { request } = event;
  const url = new URL(request.url);

  if (url.pathname.startsWith("/~oauth")) return;
  if (url.hostname.includes("supabase")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }

  const isAsset = /\.(js|css|png|jpg|jpeg|webp|svg|woff2?|wasm|onnx)$/i.test(url.pathname);
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
  }
});
