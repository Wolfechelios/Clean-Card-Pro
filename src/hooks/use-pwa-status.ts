import { useState, useEffect, useCallback } from "react";

export interface PWAStatus {
  isInstalled: boolean;
  isInstallable: boolean;
  isOnline: boolean;
  isStandalone: boolean;
  platform: "ios" | "android" | "desktop" | "unknown";
  displayMode: "browser" | "standalone" | "fullscreen" | "minimal-ui";
  serviceWorkerStatus: "pending" | "installing" | "activated" | "error" | "unsupported";
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function usePWAStatus() {
  const [status, setStatus] = useState<PWAStatus>({
    isInstalled: false,
    isInstallable: false,
    isOnline: navigator.onLine,
    isStandalone: false,
    platform: "unknown",
    displayMode: "browser",
    serviceWorkerStatus: "pending",
  });

  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Detect platform
    const userAgent = navigator.userAgent.toLowerCase();
    let platform: PWAStatus["platform"] = "desktop";
    if (/iphone|ipad|ipod/.test(userAgent)) {
      platform = "ios";
    } else if (/android/.test(userAgent)) {
      platform = "android";
    }

    // Detect display mode
    let displayMode: PWAStatus["displayMode"] = "browser";
    if (window.matchMedia("(display-mode: standalone)").matches) {
      displayMode = "standalone";
    } else if (window.matchMedia("(display-mode: fullscreen)").matches) {
      displayMode = "fullscreen";
    } else if (window.matchMedia("(display-mode: minimal-ui)").matches) {
      displayMode = "minimal-ui";
    }

    // Check if installed
    const isStandalone =
      displayMode === "standalone" ||
      displayMode === "fullscreen" ||
      (navigator as unknown as { standalone?: boolean }).standalone === true ||
      document.referrer.includes("android-app://");

    // Check service worker status
    let swStatus: PWAStatus["serviceWorkerStatus"] = "unsupported";
    if ("serviceWorker" in navigator) {
      swStatus = "pending";
      navigator.serviceWorker.ready.then(() => {
        setStatus((prev) => ({ ...prev, serviceWorkerStatus: "activated" }));
      }).catch(() => {
        setStatus((prev) => ({ ...prev, serviceWorkerStatus: "error" }));
      });
    }

    // Check for stored install prompt
    if ((window as unknown as { __pwaInstallPrompt?: BeforeInstallPromptEvent }).__pwaInstallPrompt) {
      setInstallPrompt((window as unknown as { __pwaInstallPrompt: BeforeInstallPromptEvent }).__pwaInstallPrompt);
    }

    setStatus({
      isInstalled: isStandalone,
      isInstallable: false,
      isOnline: navigator.onLine,
      isStandalone,
      platform,
      displayMode,
      serviceWorkerStatus: swStatus,
    });

    // Listen for install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      setInstallPrompt(promptEvent);
      (window as unknown as { __pwaInstallPrompt: BeforeInstallPromptEvent }).__pwaInstallPrompt = promptEvent;
      setStatus((prev) => ({ ...prev, isInstallable: true }));
    };

    const handleAppInstalled = () => {
      setInstallPrompt(null);
      (window as unknown as { __pwaInstallPrompt: null }).__pwaInstallPrompt = null;
      setStatus((prev) => ({
        ...prev,
        isInstalled: true,
        isInstallable: false,
        isStandalone: true,
      }));
    };

    const handleOnline = () => setStatus((prev) => ({ ...prev, isOnline: true }));
    const handleOffline = () => setStatus((prev) => ({ ...prev, isOnline: false }));

    const handleDisplayModeChange = () => {
      const isNowStandalone = window.matchMedia("(display-mode: standalone)").matches;
      setStatus((prev) => ({
        ...prev,
        isStandalone: isNowStandalone,
        isInstalled: isNowStandalone,
        displayMode: isNowStandalone ? "standalone" : "browser",
      }));
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const displayModeQuery = window.matchMedia("(display-mode: standalone)");
    displayModeQuery.addEventListener?.("change", handleDisplayModeChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      displayModeQuery.removeEventListener?.("change", handleDisplayModeChange);
    };
  }, []);

  const triggerInstall = useCallback(async () => {
    if (!installPrompt) return false;

    try {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      
      if (outcome === "accepted") {
        setInstallPrompt(null);
        (window as unknown as { __pwaInstallPrompt: null }).__pwaInstallPrompt = null;
        setStatus((prev) => ({
          ...prev,
          isInstalled: true,
          isInstallable: false,
        }));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [installPrompt]);

  return {
    ...status,
    canInstall: !!installPrompt || (status.platform === "ios" && !status.isInstalled),
    triggerInstall,
  };
}
