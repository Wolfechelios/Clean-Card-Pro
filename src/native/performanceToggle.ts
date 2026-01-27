
import { PerformanceMode } from './performanceMode';
import { Capacitor } from '@capacitor/core';

export async function enablePerformanceMode(enabled: boolean) {
  if (Capacitor.getPlatform() !== 'android') return;
  await PerformanceMode.setEnabled({ enabled });
  alert('App will restart to apply Performance Mode');
  location.reload();
}
