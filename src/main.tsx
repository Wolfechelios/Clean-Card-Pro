import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerPWA } from "./pwa";
import { enableSustainedPerformance } from "@/lib/performance/sustainedMode";

enableSustainedPerformance();
registerPWA();

// Auto-recover from Vite HMR disconnects (white screen fix)
let viteReloadTimer: ReturnType<typeof setTimeout> | null = null;
const observer = new MutationObserver(() => {
  const root = document.getElementById("root");
  if (root && root.childElementCount === 0) {
    // Root is empty = white screen, schedule reload
    if (!viteReloadTimer) {
      viteReloadTimer = setTimeout(() => {
        console.warn("[Recovery] White screen detected, reloading...");
        window.location.reload();
      }, 3000);
    }
  } else if (viteReloadTimer) {
    clearTimeout(viteReloadTimer);
    viteReloadTimer = null;
  }
});
observer.observe(document.getElementById("root")!, { childList: true });

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  console.log("[PWA] Install prompt captured");
  (window as any).__pwaInstallPrompt = e;
  window.dispatchEvent(new CustomEvent("pwa-install-available"));
});

window.addEventListener("appinstalled", () => {
  console.log("[PWA] App installed successfully");
  (window as any).__pwaInstallPrompt = null;
  window.dispatchEvent(new CustomEvent("pwa-installed"));
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
