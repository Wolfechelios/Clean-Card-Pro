import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
<<<<<<< HEAD
=======
import "./pwa";
>>>>>>> test-
import { enableSustainedPerformance } from "@/lib/performance/sustainedMode";

// Enable sustained performance mode on Android (does nothing on web/iOS)
enableSustainedPerformance();

// Capture PWA install prompt as early as possible
// This event fires ONLY when the browser determines the app is installable
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  console.log("[PWA] Install prompt captured");
  (window as any).__pwaInstallPrompt = e;
  // Dispatch custom event so components can react
  window.dispatchEvent(new CustomEvent("pwa-install-available"));
});

// Track when app is installed
window.addEventListener("appinstalled", () => {
  console.log("[PWA] App installed successfully");
  (window as any).__pwaInstallPrompt = null;
  window.dispatchEvent(new CustomEvent("pwa-installed"));
});

<<<<<<< HEAD
// Register service worker updates
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.ready.then((registration) => {
    registration.addEventListener("updatefound", () => {
      console.log("[PWA] New service worker available");
    });
  });
}
=======
>>>>>>> test-

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);