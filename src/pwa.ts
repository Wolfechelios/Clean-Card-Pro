// Manual PWA service worker registration — preview-safe

function isPreviewOrIframe(): boolean {
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  const host = window.location.hostname;
  return host.includes("id-preview--") || host.includes("lovableproject.com");
}

/** Unregister workers + clear caches in preview/iframe contexts */
export async function cleanupPreviewSW(): Promise<boolean> {
  if (!isPreviewOrIframe()) return false;
  if (!("serviceWorker" in navigator)) return false;

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((r) => r.unregister()));

  if (typeof caches !== "undefined") {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("cleancards")).map((k) => caches.delete(k)));
  }

  // If we were controlled by an old SW, reload once to get a clean fetch
  if (navigator.serviceWorker.controller) {
    window.location.reload();
    return true; // signal: reload triggered, don't continue boot
  }
  return false;
}

export function registerPWA() {
  if (isPreviewOrIframe()) return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      console.log("[PWA] SW registered", registration.scope);

      const CHECK_MS = 60 * 60 * 1000;
      setInterval(() => registration.update().catch(() => {}), CHECK_MS);

      if (registration.waiting) {
        console.log("[PWA] Update already waiting");
        window.dispatchEvent(new CustomEvent("pwa-update-available"));
      }

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            console.log("[PWA] New version installed, waiting to activate");
            window.dispatchEvent(new CustomEvent("pwa-update-available"));
          }
        });
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        console.log("[PWA] Controller changed, reloading...");
        window.location.reload();
      });
    } catch (error) {
      console.warn("[PWA] SW registration error", error);
    }
  });
}
