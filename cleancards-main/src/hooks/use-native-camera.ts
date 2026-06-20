import { Camera, CameraResultType, CameraSource, Photo } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

export interface NativeCameraResult {
  blob: Blob;
  dataUrl: string;
  format: string;
}

export const useNativeCamera = () => {
  const isNative = Capacitor.isNativePlatform();

  const takePhoto = async (): Promise<NativeCameraResult | null> => {
    if (!isNative) {
      console.log('Not on native platform, use web camera instead');
      return null;
    }

    try {
      const photo = await Camera.getPhoto({
        quality: 95,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        correctOrientation: true,
        width: 3840,
        height: 2160,
      });

      if (!photo.dataUrl) {
        throw new Error('No image data returned');
      }

      // Convert dataUrl to Blob
      const response = await fetch(photo.dataUrl);
      const blob = await response.blob();

      return {
        blob,
        dataUrl: photo.dataUrl,
        format: photo.format,
      };
    } catch (error: any) {
      console.error('Native camera error:', error);
      throw error;
    }
  };

  const pickFromGallery = async (): Promise<NativeCameraResult | null> => {
    if (!isNative) {
      return null;
    }

    try {
      const photo = await Camera.getPhoto({
        quality: 95,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Photos,
        correctOrientation: true,
      });

      if (!photo.dataUrl) {
        throw new Error('No image data returned');
      }

      const response = await fetch(photo.dataUrl);
      const blob = await response.blob();

      return {
        blob,
        dataUrl: photo.dataUrl,
        format: photo.format,
      };
    } catch (error: any) {
      console.error('Gallery pick error:', error);
      throw error;
    }
  };

  const checkPermissions = async (): Promise<boolean> => {
    if (!isNative) return true;

    try {
      const permissions = await Camera.checkPermissions();
      if (permissions.camera === 'granted' && permissions.photos === 'granted') {
        return true;
      }

      const requested = await Camera.requestPermissions();
      return requested.camera === 'granted';
    } catch (error) {
      console.error('Permission check error:', error);
      return false;
    }
  };

  return {
    isNative,
    takePhoto,
    pickFromGallery,
    checkPermissions,
  };
};
