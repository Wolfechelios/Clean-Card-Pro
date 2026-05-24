// Manual PWA service worker registration — preview-safe

function isPreviewOrIframe(): boolean {
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  const host = window.location.hostname;
  return (
    host.includes("id-preview--") ||
    host.includes("lovableproject.com") ||
    host.includes("lovable.app") ||
    host === "localhost" ||
    host === "127.0.0.1"
  );
}

/** Unregister workers + clear ALL caches in preview/iframe contexts */
export async function cleanupPreviewSW(): Promise<boolean> {
  if (!isPreviewOrIframe()) return false;
  if (!("serviceWorker" in navigator)) return false;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));

    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      // Clear ALL caches in preview, not just cleancards-prefixed ones
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (err) {
    console.warn("[PWA] cleanup error", err);
  }

  // Only reload once per session to avoid infinite reload loops
  const RELOAD_KEY = "__sw_cleanup_reloaded__";
  if (navigator.serviceWorker.controller && !sessionStorage.getItem(RELOAD_KEY)) {
    sessionStorage.setItem(RELOAD_KEY, "1");
    window.location.reload();
    return true;
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
