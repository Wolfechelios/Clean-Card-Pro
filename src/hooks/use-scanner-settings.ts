import { useState, useEffect, useCallback } from "react";

const SCANNER_SETTINGS_KEY = "card-scanner-settings";

export type ScanMode = "SAVE" | "SCAN_ONLY";
export type WhiteBalanceMode = "auto" | "continuous" | "manual";

/* NEW */
export type CaptureQualityMode = "rapid" | "grading";

export interface ScannerSettings {
  autoConfirmEnabled: boolean;
  autoConfirmThreshold: number;
  scanMode: ScanMode;

  // Capture UX
  hapticsOnCapture: boolean;
  flashOnCapture: boolean;
  autoTimerIntervalSeconds: 1 | 1.5 | 2 | 5;
  voiceCaptureEnabled: boolean;
  voiceCaptureKeyword: string;
  manualFocusLock: boolean;
  fullscreenScanMode: boolean;

  // Camera assist
  autoFocusAssist: boolean;
  autoFocusOnStart: boolean;
  autoFocusBeforeCapture: boolean;
  autoZoomOnStart: boolean;
  autoZoomLevel: 1 | 1.5 | 2 | 2.5 | 3;

  // Lighting / white balance
  whiteBalanceMode: WhiteBalanceMode;
  whiteBalanceTemperatureK: number;

  // Low light assist
  lowLightAssistEnabled: boolean;
  lowLightTargetBrightness: number;
  lowLightAllowTorch: boolean;

  // Batch processing
  batchScanSize: number;

  /* ===================== */
  /* IMAGE QUALITY MODES   */
  /* ===================== */

  captureQualityMode: CaptureQualityMode;

  // RAPID mode
  rapidMaxLongEdge: number;      // px
  rapidPreferWebp: boolean;

  // GRADING mode
  gradingBurstFrames: number;    // frames per capture
  gradingMinSharpness: number;   // Laplacian variance threshold
  gradingOutputFormat: "jpeg" | "png" | "webp";
  gradingJpegQuality: number;    // 0.9 – 1.0
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

  autoFocusAssist: true,
  autoFocusOnStart: true,
  autoFocusBeforeCapture: true,
  autoZoomOnStart: false,
  autoZoomLevel: 2,

  whiteBalanceMode: "continuous",
  whiteBalanceTemperatureK: 5000,

  lowLightAssistEnabled: true,
  lowLightTargetBrightness: 55,
  lowLightAllowTorch: false,

  batchScanSize: 3,

  /* ===== NEW DEFAULTS ===== */

  captureQualityMode: "rapid",

  rapidMaxLongEdge: 1600,
  rapidPreferWebp: true,

  gradingBurstFrames: 7,
  gradingMinSharpness: 25,
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
        // Merge safely so older saves don’t break
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      }
    } catch (error) {
      console.error("Failed to load scanner settings:", error);
    }
  }, []);

  const updateSettings = useCallback(
    (updates: Partial<ScannerSettings>) => {
      setSettings((prev) => {
        const newSettings = { ...prev, ...updates };
        try {
          localStorage.setItem(
            SCANNER_SETTINGS_KEY,
            JSON.stringify(newSettings)
          );
        } catch (error) {
          console.error("Failed to save scanner settings:", error);
        }
        return newSettings;
      });
    },
    []
  );

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

// Standalone getter (used outside React)
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
