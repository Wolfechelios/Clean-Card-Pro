import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

export interface StoredFile {
  path: string;
  data: string;
}

export const useNativeStorage = () => {
  const isNative = Capacitor.isNativePlatform();

  const saveImage = async (blob: Blob, fileName: string): Promise<string | null> => {
    if (!isNative) {
      console.log('Not on native platform, cannot save to device storage');
      return null;
    }

    try {
      // Convert blob to base64
      const base64 = await blobToBase64(blob);
      
      const result = await Filesystem.writeFile({
        path: `card-scans/${fileName}`,
        data: base64,
        directory: Directory.Data,
        recursive: true,
      });

      return result.uri;
    } catch (error: any) {
      console.error('Save image error:', error);
      throw error;
    }
  };

  const readImage = async (fileName: string): Promise<string | null> => {
    if (!isNative) return null;

    try {
      const result = await Filesystem.readFile({
        path: `card-scans/${fileName}`,
        directory: Directory.Data,
      });

      // Handle both string and Blob results
      if (typeof result.data === 'string') {
        return `data:image/jpeg;base64,${result.data}`;
      }
      return null;
    } catch (error: any) {
      console.error('Read image error:', error);
      return null;
    }
  };

  const deleteImage = async (fileName: string): Promise<boolean> => {
    if (!isNative) return false;

    try {
      await Filesystem.deleteFile({
        path: `card-scans/${fileName}`,
        directory: Directory.Data,
      });
      return true;
    } catch (error: any) {
      console.error('Delete image error:', error);
      return false;
    }
  };

  const listImages = async (): Promise<string[]> => {
    if (!isNative) return [];

    try {
      const result = await Filesystem.readdir({
        path: 'card-scans',
        directory: Directory.Data,
      });

      return result.files.map(f => f.name);
    } catch (error: any) {
      // Directory might not exist yet
      if (error.message?.includes('does not exist')) {
        return [];
      }
      console.error('List images error:', error);
      return [];
    }
  };

  const saveCardData = async (cardId: string, data: any): Promise<boolean> => {
    if (!isNative) return false;

    try {
      await Filesystem.writeFile({
        path: `card-data/${cardId}.json`,
        data: JSON.stringify(data),
        directory: Directory.Data,
        encoding: Encoding.UTF8,
        recursive: true,
      });
      return true;
    } catch (error: any) {
      console.error('Save card data error:', error);
      return false;
    }
  };

  const readCardData = async (cardId: string): Promise<any | null> => {
    if (!isNative) return null;

    try {
      const result = await Filesystem.readFile({
        path: `card-data/${cardId}.json`,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
      });

      if (typeof result.data === 'string') {
        return JSON.parse(result.data);
      }
      return null;
    } catch (error: any) {
      console.error('Read card data error:', error);
      return null;
    }
  };

  const clearCache = async (): Promise<boolean> => {
    if (!isNative) return false;

    try {
      await Filesystem.rmdir({
        path: 'card-scans',
        directory: Directory.Data,
        recursive: true,
      });
      return true;
    } catch (error: any) {
      console.error('Clear cache error:', error);
      return false;
    }
  };

  const getStorageStats = async (): Promise<{ files: number; estimatedSize: string } | null> => {
    if (!isNative) return null;

    try {
      const images = await listImages();
      return {
        files: images.length,
        estimatedSize: `~${Math.round(images.length * 0.5)}MB`, // Estimate 500KB per image
      };
    } catch (error) {
      return null;
    }
  };

  return {
    isNative,
    saveImage,
    readImage,
    deleteImage,
    listImages,
    saveCardData,
    readCardData,
    clearCache,
    getStorageStats,
  };
};

// Helper function
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result as string;
      // Remove the data URL prefix to get just the base64
      const base64Data = base64.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
