import { useState, useEffect, useCallback } from "react";

const SCANNER_SETTINGS_KEY = "card-scanner-settings";

export type ScanMode = "SAVE" | "SCAN_ONLY";

export interface ScannerSettings {
  autoConfirmEnabled: boolean;
  autoConfirmThreshold: number; // 0-100, percentage
  scanMode: ScanMode;

  // Capture UX
  hapticsOnCapture: boolean;
  flashOnCapture: boolean;
  autoTimerIntervalSeconds: 1 | 1.5 | 2 | 5;
  voiceCaptureEnabled: boolean;
  voiceCaptureKeyword: string;
  manualFocusLock: boolean;
  fullscreenScanMode: boolean;

  // Batch processing
  batchScanSize: number; // 1-3, concurrent cards to process (max 3)

  // Feature flags - Camera
  featureAutoFocus: boolean;
  featureContinuousAutoFocus: boolean;
  featureTapToFocus: boolean;
  featureZoomControls: boolean;
  featureDigitalZoomFallback: boolean;
  featurePinchToZoom: boolean;
  featureTorchControl: boolean;

  // Feature flags - Capture
  featureAntiGlare: boolean;
  featureOCREnhancement: boolean;
  featureHighResCapture: boolean;
}

const DEFAULT_SETTINGS: ScannerSettings = {
  autoConfirmEnabled: true,
  autoConfirmThreshold: 75,
  scanMode: "SAVE",

  hapticsOnCapture: true,
  flashOnCapture: true,
  autoTimerIntervalSeconds: 2,
  voiceCaptureEnabled: false,
  voiceCaptureKeyword: "snap",
  manualFocusLock: false,
  fullscreenScanMode: false,

  batchScanSize: 3,

  // Feature flags - Camera (all enabled by default)
  featureAutoFocus: true,
  featureContinuousAutoFocus: true,
  featureTapToFocus: true,
  featureZoomControls: true,
  featureDigitalZoomFallback: true,
  featurePinchToZoom: true,
  featureTorchControl: true,

  // Feature flags - Capture (all enabled by default)
  featureAntiGlare: true,
  featureOCREnhancement: true,
  featureHighResCapture: true,
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
