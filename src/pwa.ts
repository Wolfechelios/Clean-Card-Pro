// Manual PWA service worker registration

export function registerPWA() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      console.log("[PWA] SW registered", registration.scope);

      // Periodic update checks — every hour
      const CHECK_MS = 60 * 60 * 1000;
      setInterval(() => registration.update().catch(() => {}), CHECK_MS);

      // Check if there's already a waiting worker (e.g. from a previous visit)
      if (registration.waiting) {
        console.log("[PWA] Update already waiting");
        window.dispatchEvent(new CustomEvent("pwa-update-available"));
      }

      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          // New SW is installed and waiting — NOT "activated"
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            console.log("[PWA] New version installed, waiting to activate");
            window.dispatchEvent(new CustomEvent("pwa-update-available"));
          }
        });
      });

      // When the new SW takes over, reload the page
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
