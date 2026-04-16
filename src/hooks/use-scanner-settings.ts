import { useState, useEffect, useCallback } from "react";

const SCANNER_SETTINGS_KEY = "card-scanner-settings";

export type ScanMode = "SAVE" | "SCAN_ONLY" | "REMOVE";
export type ScanEngineProfileId = "balanced_default" | "ipad_mac_paired" | "redmagic_standalone";

export interface ScannerSettings {
  autoConfirmEnabled: boolean;
  autoConfirmThreshold: number;
  scanMode: ScanMode;
  scanEngineProfile: ScanEngineProfileId;

  hapticsOnCapture: boolean;
  flashOnCapture: boolean;
  autoTimerIntervalSeconds: 1 | 1.25 | 1.5 | 2 | 5;
  voiceCaptureEnabled: boolean;
  voiceCaptureKeyword: string;
  manualFocusLock: boolean;
  fullscreenScanMode: boolean;

  autoZoomEnabled: boolean;

  autoCaptureEnabled: boolean;

  batchScanSize: number;

  // Microscope settings
  preferredMicroscopeDeviceId: string;

  // Foil detection
  foilDetectionEnabled: boolean;
  foilDetectionMode: "fast" | "accurate";

  // Game type filter for identification
  gameTypeFilter: "auto" | "mtg" | "yugioh" | "pokemon" | "sports" | "gpk" | "marvel" | "onepiece" | "other";
}

const DEFAULT_SETTINGS: ScannerSettings = {
  autoConfirmEnabled: true,
  autoConfirmThreshold: 75,
  scanMode: "SAVE",
  scanEngineProfile: "balanced_default",

  hapticsOnCapture: true,
  flashOnCapture: true,
  autoTimerIntervalSeconds: 2,
  voiceCaptureEnabled: false,
  voiceCaptureKeyword: "snap",
  manualFocusLock: false,
  fullscreenScanMode: false,

  autoZoomEnabled: true,

  autoCaptureEnabled: false,

  batchScanSize: 3,

  preferredMicroscopeDeviceId: "",

  foilDetectionEnabled: true,
  foilDetectionMode: "fast",

  gameTypeFilter: "auto",
};

export function useScannerSettings() {
  const [settings, setSettings] = useState<ScannerSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SCANNER_SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      }
    } catch (error) {
      console.error("Failed to load scanner settings:", error);
    }
  }, []);

  const updateSettings = useCallback((updates: Partial<ScannerSettings>) => {
    setSettings((prev) => {
      const newSettings = { ...prev, ...updates };
      try {
        localStorage.setItem(SCANNER_SETTINGS_KEY, JSON.stringify(newSettings));
      } catch (error) {
        console.error("Failed to save scanner settings:", error);
      }
      return newSettings;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    try {
      localStorage.removeItem(SCANNER_SETTINGS_KEY);
    } catch (error) {
      console.error("Failed to reset scanner settings:", error);
    }
  }, []);

  return { settings, updateSettings, resetSettings };
}

export function getScannerSettings(): ScannerSettings {
  try {
    const stored = localStorage.getItem(SCANNER_SETTINGS_KEY);
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    }
  } catch (error) {
    console.error("Failed to load scanner settings:", error);
  }
  return DEFAULT_SETTINGS;
}
