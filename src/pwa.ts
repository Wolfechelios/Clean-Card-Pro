// Manual PWA service worker registration (no vite-plugin-pwa needed)

export function registerPWA() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      console.log("[PWA] SW registered", registration.scope);

      // Periodic update checks
      const CHECK_MS = 60 * 60 * 1000; // 1 hour
      setInterval(() => registration.update().catch(() => {}), CHECK_MS);

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "activated") {
            console.log("[PWA] Update available");
            window.dispatchEvent(new CustomEvent("pwa-update-available"));
          }
        });
      });
    } catch (error) {
      console.warn("[PWA] SW registration error", error);
    }
  });
}
