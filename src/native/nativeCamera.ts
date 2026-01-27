
import { registerPlugin } from '@capacitor/core';

export interface NativeCameraPlugin {
  capture(): Promise<{ uri: string }>;
}

export const NativeCamera = registerPlugin<NativeCameraPlugin>('NativeCamera');
