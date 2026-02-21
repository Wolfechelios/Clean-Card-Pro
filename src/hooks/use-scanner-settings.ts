import { useState, useEffect, useCallback } from "react";

const SCANNER_SETTINGS_KEY = "card-scanner-settings";

export type ScanMode = "SAVE" | "SCAN_ONLY" | "REMOVE";

export interface ScannerSettings {
  autoConfirmEnabled: boolean;
  autoConfirmThreshold: number; // 0-100, percentage
  scanMode: ScanMode; // NEW

  // Capture UX
  hapticsOnCapture: boolean;
  flashOnCapture: boolean;
  autoTimerIntervalSeconds: 1 | 1.5 | 2 | 5;
  voiceCaptureEnabled: boolean;
  voiceCaptureKeyword: string;
  manualFocusLock: boolean;
  fullscreenScanMode: boolean;

  // Smart zoom
  autoZoomEnabled: boolean; // Auto zoom-out when cards get too close (blurry)

  // Batch processing
  batchScanSize: number; // 1-3, concurrent cards to process (max 3)

  // Local Accelerator (Mac/PC) — optional, superset feature
  gpuOffloadEnabled: boolean;
  gpuServerBaseUrl: string; // e.g. http://192.168.1.5:8000 or 192.168.1.5:8000
  gpuPreferForQueue: boolean; // use GPU server for queued job processing
  gpuPreferForLive: boolean; // use GPU server for live preview overlay
  gpuStreamMaxFps: number; // 2-30
  gpuStreamTargetWidth: number; // 320-1280
  gpuStreamJpegQuality: number; // 0.35-0.95
}

const DEFAULT_SETTINGS: ScannerSettings = {
  autoConfirmEnabled: true,
  autoConfirmThreshold: 75,
  scanMode: "SAVE", // NEW default keeps old behavior

  hapticsOnCapture: true,
  flashOnCapture: true,
  autoTimerIntervalSeconds: 2,
  voiceCaptureEnabled: false,
  voiceCaptureKeyword: "snap",
  manualFocusLock: false,
  fullscreenScanMode: false,

  autoZoomEnabled: true, // Auto zoom-out for card stacks

  batchScanSize: 3, // Default 3 concurrent workers

  gpuOffloadEnabled: false,
  gpuServerBaseUrl: "",
  gpuPreferForQueue: true,
  gpuPreferForLive: true,
  gpuStreamMaxFps: 12,
  gpuStreamTargetWidth: 720,
  gpuStreamJpegQuality: 0.65,
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

  return {
    settings,
    updateSettings,
    resetSettings,
  };
}

// Standalone function to get settings without hook (for use in other hooks)
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
