import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { registerPWA, cleanupPreviewSW } from "./pwa";
import { enableSustainedPerformance } from "@/lib/performance/sustainedMode";

enableSustainedPerformance();

// Clean up stale service workers in preview/iframe, then boot
(async () => {
  const reloading = await cleanupPreviewSW();
  if (reloading) return; // page will reload, skip mount

  registerPWA();

  // Auto-recover from Vite HMR disconnects (white screen fix)
  let viteReloadTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectOverlay: HTMLDivElement | null = null;

  function showReconnectOverlay() {
    if (reconnectOverlay) return;
    reconnectOverlay = document.createElement("div");
    reconnectOverlay.id = "reconnect-overlay";
    reconnectOverlay.innerHTML = `
      <div style="position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);gap:16px;">
        <div style="width:40px;height:40px;border:3px solid rgba(251,191,36,0.3);border-top-color:#fbbf24;border-radius:50%;animation:rc-spin 0.8s linear infinite;"></div>
        <p style="color:#fbbf24;font-family:system-ui,sans-serif;font-size:16px;font-weight:600;letter-spacing:0.05em;">Reconnecting…</p>
        <p style="color:rgba(255,255,255,0.5);font-family:system-ui,sans-serif;font-size:13px;">The app will reload automatically</p>
      </div>
      <style>@keyframes rc-spin{to{transform:rotate(360deg)}}</style>
    `;
    document.body.appendChild(reconnectOverlay);
  }

  function hideReconnectOverlay() {
    if (reconnectOverlay) {
      reconnectOverlay.remove();
      reconnectOverlay = null;
    }
  }

  const observer = new MutationObserver(() => {
    const root = document.getElementById("root");
    if (root && root.childElementCount === 0) {
      if (!viteReloadTimer) {
        showReconnectOverlay();
        viteReloadTimer = setTimeout(() => {
          console.warn("[Recovery] White screen detected, reloading...");
          window.location.reload();
        }, 3000);
      }
    } else if (viteReloadTimer) {
      clearTimeout(viteReloadTimer);
      viteReloadTimer = null;
      hideReconnectOverlay();
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
})();
