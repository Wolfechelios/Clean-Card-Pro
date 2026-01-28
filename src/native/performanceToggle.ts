import { Capacitor } from '@capacitor/core';
import { enableSustainedPerformance, disableSustainedPerformance } from '@/lib/performance/sustainedMode';

export async function enablePerformanceMode(enabled: boolean) {
  if (Capacitor.getPlatform() !== 'android') return;
  
  if (enabled) {
    await enableSustainedPerformance();
  } else {
    await disableSustainedPerformance();
  }
}
