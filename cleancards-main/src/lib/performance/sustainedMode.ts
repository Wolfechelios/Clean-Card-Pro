/**
 * Android Sustained Performance Mode
 * 
 * Enables sustained performance mode on Android devices to prevent
 * CPU/GPU throttling during intensive scanning operations.
 * 
 * Does nothing on web or iOS.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';

interface SustainedPerformancePlugin {
  enable(): Promise<{ enabled: boolean }>;
  disable(): Promise<{ enabled: boolean }>;
  isEnabled(): Promise<{ enabled: boolean }>;
}

// Register the native plugin (only available on Android)
const SustainedPerformance = registerPlugin<SustainedPerformancePlugin>('SustainedPerformance');

let initialized = false;

/**
 * Enable sustained performance mode on Android.
 * Silently does nothing on web or iOS.
 */
export async function enableSustainedPerformance(): Promise<boolean> {
  // Only run on Android native
  if (Capacitor.getPlatform() !== 'android') {
    console.log('[SustainedMode] Skipped (not Android)');
    return false;
  }

  if (initialized) {
    console.log('[SustainedMode] Already initialized');
    return true;
  }

  try {
    const result = await SustainedPerformance.enable();
    initialized = result.enabled;
    console.log('[SustainedMode] Enabled:', result.enabled);
    return result.enabled;
  } catch (error) {
    // Plugin not available or failed - silent fallback
    console.warn('[SustainedMode] Failed to enable:', error);
    return false;
  }
}

/**
 * Disable sustained performance mode on Android.
 * Silently does nothing on web or iOS.
 */
export async function disableSustainedPerformance(): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') {
    return false;
  }

  try {
    const result = await SustainedPerformance.disable();
    initialized = false;
    console.log('[SustainedMode] Disabled');
    return !result.enabled;
  } catch (error) {
    console.warn('[SustainedMode] Failed to disable:', error);
    return false;
  }
}

/**
 * Check if sustained mode is currently enabled.
 */
export async function isSustainedModeEnabled(): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') {
    return false;
  }

  try {
    const result = await SustainedPerformance.isEnabled();
    return result.enabled;
  } catch {
    return false;
  }
}
