import { useState, useEffect, useCallback } from "react";

const SCANNER_SETTINGS_KEY = "card-scanner-settings";

export type ScanMode = "SAVE" | "SCAN_ONLY";

<<<<<<< Updated upstream
<<<<<<< Updated upstream
<<<<<<< Updated upstream
=======
=======
>>>>>>> Stashed changes
=======
>>>>>>> Stashed changes
// Image quality modes
export type CaptureQualityMode = "RAPID" | "GRADING";
export type GradingOutputFormat = "jpeg" | "png" | "webp";

export type WhiteBalanceMode = "auto" | "continuous" | "manual";

>>>>>>> Stashed changes
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

  // Batch processing
  batchScanSize: number; // 1-3, concurrent cards to process (max 3)

  // Image quality & performance
  captureQualityMode: CaptureQualityMode;
  // RAPID mode settings
  rapidMaxLongEdge: number; // resize to this long edge before enqueue (0 = no resize)
  rapidJpegQuality: number; // 0-1
  rapidPreferWebp: boolean;

  // GRADING mode settings
  gradingBurstFrames: number; // 1-12, capture burst and choose sharpest
  gradingMinSharpness: number; // 0-100, reject if below
  gradingOutputFormat: GradingOutputFormat;
  gradingJpegQuality: number; // 0-1
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

  batchScanSize: 3, // Default 3 concurrent workers

  captureQualityMode: "RAPID",
  rapidMaxLongEdge: 1600,
  rapidJpegQuality: 0.88,
  rapidPreferWebp: true,

  gradingBurstFrames: 7,
  gradingMinSharpness: 22,
  gradingOutputFormat: "jpeg",
  gradingJpegQuality: 0.98,
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
