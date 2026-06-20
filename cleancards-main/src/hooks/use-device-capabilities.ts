/**
 * Device Capabilities Hook
 * Leverages phone hardware features for better PWA experience
 */

import { useState, useEffect, useCallback } from "react";

interface DeviceCapabilities {
  // Storage
  isPersisted: boolean;
  storageQuota: { used: number; total: number } | null;
  
  // Screen
  isWakeLockSupported: boolean;
  isWakeLockActive: boolean;
  
  // Network
  isOnline: boolean;
  connectionType: string | null;
  effectiveType: string | null;
  downlink: number | null;
  
  // Device
  deviceMemory: number | null;
  hardwareConcurrency: number;
  isTouchDevice: boolean;
  isStandalone: boolean;
}

interface DeviceActions {
  requestPersistentStorage: () => Promise<boolean>;
  requestWakeLock: () => Promise<boolean>;
  releaseWakeLock: () => void;
  vibrate: (pattern?: number | number[]) => void;
}

export function useDeviceCapabilities(): DeviceCapabilities & DeviceActions {
  const [isPersisted, setIsPersisted] = useState(false);
  const [storageQuota, setStorageQuota] = useState<{ used: number; total: number } | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
  const [networkInfo, setNetworkInfo] = useState<{
    connectionType: string | null;
    effectiveType: string | null;
    downlink: number | null;
  }>({ connectionType: null, effectiveType: null, downlink: null });

  // Check if running as installed PWA
  const isStandalone = 
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;

  // Check storage persistence on mount
  useEffect(() => {
    const checkPersistence = async () => {
      if (navigator.storage && navigator.storage.persisted) {
        const persisted = await navigator.storage.persisted();
        setIsPersisted(persisted);
      }
    };

    const checkQuota = async () => {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        setStorageQuota({
          used: estimate.usage || 0,
          total: estimate.quota || 0,
        });
      }
    };

    checkPersistence();
    checkQuota();
  }, []);

  // Network listeners
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Network Information API
    const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (connection) {
      const updateNetworkInfo = () => {
        setNetworkInfo({
          connectionType: connection.type || null,
          effectiveType: connection.effectiveType || null,
          downlink: connection.downlink || null,
        });
      };
      updateNetworkInfo();
      connection.addEventListener("change", updateNetworkInfo);
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
        connection.removeEventListener("change", updateNetworkInfo);
      };
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Wake lock visibility handler
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (wakeLock !== null && document.visibilityState === "visible") {
        // Re-acquire wake lock when page becomes visible
        try {
          const newLock = await navigator.wakeLock.request("screen");
          setWakeLock(newLock);
        } catch (e) {
          // Silent fail
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [wakeLock]);

  // Request persistent storage
  const requestPersistentStorage = useCallback(async (): Promise<boolean> => {
    if (navigator.storage && navigator.storage.persist) {
      const persisted = await navigator.storage.persist();
      setIsPersisted(persisted);
      return persisted;
    }
    return false;
  }, []);

  // Request wake lock (keep screen on)
  const requestWakeLock = useCallback(async (): Promise<boolean> => {
    if ("wakeLock" in navigator) {
      try {
        const lock = await navigator.wakeLock.request("screen");
        setWakeLock(lock);
        lock.addEventListener("release", () => setWakeLock(null));
        return true;
      } catch (e) {
        console.warn("Wake lock request failed:", e);
        return false;
      }
    }
    return false;
  }, []);

  // Release wake lock
  const releaseWakeLock = useCallback(() => {
    if (wakeLock) {
      wakeLock.release();
      setWakeLock(null);
    }
  }, [wakeLock]);

  // Vibrate
  const vibrate = useCallback((pattern: number | number[] = 50) => {
    if ("vibrate" in navigator) {
      navigator.vibrate(pattern);
    }
  }, []);

  return {
    // Storage
    isPersisted,
    storageQuota,

    // Screen
    isWakeLockSupported: "wakeLock" in navigator,
    isWakeLockActive: wakeLock !== null,

    // Network
    isOnline,
    connectionType: networkInfo.connectionType,
    effectiveType: networkInfo.effectiveType,
    downlink: networkInfo.downlink,

    // Device
    deviceMemory: (navigator as any).deviceMemory || null,
    hardwareConcurrency: navigator.hardwareConcurrency || 1,
    isTouchDevice: "ontouchstart" in window || navigator.maxTouchPoints > 0,
    isStandalone,

    // Actions
    requestPersistentStorage,
    requestWakeLock,
    releaseWakeLock,
    vibrate,
  };
}
