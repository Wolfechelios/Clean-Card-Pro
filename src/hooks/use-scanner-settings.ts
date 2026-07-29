import { useState, useEffect, useCallback } from "react";
import type { CaptureProfileId } from "@/lib/rapidScan/contracts";

const SCANNER_SETTINGS_KEY = "card-scanner-settings";

export type ScanMode = "SAVE" | "SCAN_ONLY" | "REMOVE";

export interface ScannerSettings {
  autoConfirmEnabled: boolean;
  autoConfirmThreshold: number;
  scanMode: ScanMode;

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

  captureMode: "auto" | "manual";
  selectedSetId: string | null;
  selectedSetName: string | null;
  captureProfileId: CaptureProfileId;

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

  captureMode: "manual",
  selectedSetId: null,
  selectedSetName: null,
  captureProfileId: "standard",

  preferredMicroscopeDeviceId: "",

  foilDetectionEnabled: true,
  foilDetectionMode: "fast",

  gameTypeFilter: "auto",
};

function readStoredScannerSettings(): Partial<ScannerSettings> | null {
  try {
    const stored = localStorage.getItem(SCANNER_SETTINGS_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    return parsed && typeof parsed === "object"
      ? parsed as Partial<ScannerSettings>
      : null;
  } catch (error) {
    console.error("Failed to load scanner settings:", error);
    return null;
  }
}

export function updateStoredScannerSettings(
  updates: Partial<ScannerSettings>,
  fallback: ScannerSettings = DEFAULT_SETTINGS,
): ScannerSettings {
  const stored = readStoredScannerSettings();
  const newSettings = {
    ...DEFAULT_SETTINGS,
    ...(stored ?? fallback),
    ...updates,
  };
  try {
    localStorage.setItem(SCANNER_SETTINGS_KEY, JSON.stringify(newSettings));
  } catch (error) {
    console.error("Failed to save scanner settings:", error);
  }
  return newSettings;
}

export function useScannerSettings() {
  const [settings, setSettings] = useState<ScannerSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettings(getScannerSettings());
  }, []);

  const updateSettings = useCallback((updates: Partial<ScannerSettings>) => {
    setSettings((prev) => updateStoredScannerSettings(updates, prev));
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
  const stored = readStoredScannerSettings();
  return stored ? { ...DEFAULT_SETTINGS, ...stored } : DEFAULT_SETTINGS;
}
