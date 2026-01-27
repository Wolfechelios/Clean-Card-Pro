
import { registerPlugin } from '@capacitor/core';

export interface PerformanceModePlugin {
  setEnabled(options: { enabled: boolean }): Promise<void>;
  isEnabled(): Promise<{ enabled: boolean }>;
}

export const PerformanceMode = registerPlugin<PerformanceModePlugin>('PerformanceMode');
