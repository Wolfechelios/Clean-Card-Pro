// @ts-ignore - virtual module provided by vite-plugin-pwa
import { registerSW } from "virtual:pwa-register";

// Registers the Vite PWA service worker with aggressive update behavior.
// - autoUpdate: checks for updates in the background
// - immediate: registers ASAP
export const updateSW = registerSW({
  immediate: true,
  onOfflineReady() {
    console.log("[PWA] Offline ready");
    window.dispatchEvent(new CustomEvent("pwa-offline-ready"));
  },
  onNeedRefresh() {
    console.log("[PWA] Update available");
    window.dispatchEvent(new CustomEvent("pwa-update-available"));
  },
  onRegistered(registration) {
    if (!registration) return;
    // Periodic update checks (best-effort)
    const CHECK_MS = 60 * 60 * 1000; // 1 hour
    setInterval(() => registration.update().catch(() => {}), CHECK_MS);
  },
  onRegisterError(error) {
    console.warn("[PWA] SW registration error", error);
  },
});
