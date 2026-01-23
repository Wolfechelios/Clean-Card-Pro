import { useState, useEffect, useCallback } from "react";

const SCANNER_SETTINGS_KEY = "card-scanner-settings";

export type ScanMode = "SAVE" | "SCAN_ONLY";

// Image quality modes
export type CaptureQualityMode = "RAPID" | "GRADING";
export type GradingOutputFormat = "jpeg" | "png" | "webp";

export type WhiteBalanceMode = "auto" | "continuous" | "manual";

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

  // Camera assist
  autoFocusAssist: boolean; // periodic refocus helper
  autoFocusOnStart: boolean;
  autoFocusBeforeCapture: boolean;
  autoZoomOnStart: boolean;
  autoZoomLevel: 1 | 1.5 | 2 | 2.5 | 3;

  // Lighting / white balance (best-effort; browser support varies)
  whiteBalanceMode: WhiteBalanceMode;
  whiteBalanceTemperatureK: number; // used when whiteBalanceMode === 'manual'

  // Low light assist (best-effort exposure/torch nudges; browser support varies)
  lowLightAssistEnabled: boolean;
  lowLightTargetBrightness: number; // 0-100, higher = brighter target
  lowLightAllowTorch: boolean; // if supported, can toggle torch in very low light

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

  batchScanSize: 3, // Default 3 concurrent workers

  captureQualityMode: "RAPID",
  rapidMaxLongEdge: 1600,
  rapidJpegQuality: 0.88,
  // WebP is great, but several downstream pipelines assume JPEG.
  // Keep JPEG as the safe default; users can opt into WebP in Settings.
  rapidPreferWebp: false,

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
