import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./pwa";
import { enableSustainedPerformance } from "@/lib/performance/sustainedMode";

enableSustainedPerformance();

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
