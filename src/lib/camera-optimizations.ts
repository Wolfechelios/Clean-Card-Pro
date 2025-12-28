/**
 * Ultra-optimized camera settings for maximum quality card scanning
 * - 8K/4K resolution support
 * - Fast continuous autofocus
 * - Anti-glare image processing
 */

export interface OptimizedCameraConstraints {
  video: MediaTrackConstraints;
  audio: false;
}

// Maximum resolution camera constraints with progressive fallback
export const getMaxCameraConstraints = (facingMode: 'environment' | 'user' = 'environment', deviceId?: string): OptimizedCameraConstraints[] => {
  const baseConstraints = deviceId 
    ? { deviceId: { exact: deviceId } }
    : { facingMode: { ideal: facingMode } };

  return [
    // Try 1: 8K Ultra HD (7680x4320)
    {
      video: {
        ...baseConstraints,
        width: { ideal: 7680, min: 3840 },
        height: { ideal: 4320, min: 2160 },
        frameRate: { ideal: 30, min: 15 },
        aspectRatio: { ideal: 16/9 },
      },
      audio: false as const,
    },
    // Try 2: 4K UHD (3840x2160)
    {
      video: {
        ...baseConstraints,
        width: { ideal: 3840, min: 1920 },
        height: { ideal: 2160, min: 1080 },
        frameRate: { ideal: 30 },
      },
      audio: false as const,
    },
    // Try 3: 2K QHD (2560x1440)
    {
      video: {
        ...baseConstraints,
        width: { ideal: 2560 },
        height: { ideal: 1440 },
        frameRate: { ideal: 30 },
      },
      audio: false as const,
    },
    // Try 4: Full HD (1920x1080)
    {
      video: {
        ...baseConstraints,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false as const,
    },
    // Try 5: Basic HD
    {
      video: {
        ...baseConstraints,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false as const,
    },
    // Fallback: Any camera
    {
      video: deviceId ? { deviceId } : { facingMode },
      audio: false as const,
    },
  ];
};

// Apply fast continuous autofocus
export const applyFastAutofocus = async (stream: MediaStream): Promise<void> => {
  try {
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    const capabilities = track.getCapabilities?.() as any;
    
    // Apply continuous autofocus with fast tracking
    if (capabilities?.focusMode?.includes('continuous')) {
      await track.applyConstraints({
        advanced: [
          { focusMode: 'continuous' } as any,
          // Try to set focus distance to close range for cards
          ...(capabilities.focusDistance ? [{ focusDistance: capabilities.focusDistance.min } as any] : []),
        ]
      });
      console.log('Fast continuous autofocus enabled');
    }

    // Enable auto white balance for better colors
    if (capabilities?.whiteBalanceMode?.includes('continuous')) {
      await track.applyConstraints({
        advanced: [{ whiteBalanceMode: 'continuous' } as any]
      });
    }

    // Enable auto exposure
    if (capabilities?.exposureMode?.includes('continuous')) {
      await track.applyConstraints({
        advanced: [{ exposureMode: 'continuous' } as any]
      });
    }

  } catch (e) {
    console.log('Autofocus optimization not fully available:', e);
  }
};

// Trigger single-shot fast focus
export const triggerFastFocus = async (stream: MediaStream): Promise<boolean> => {
  try {
    const track = stream.getVideoTracks()[0];
    if (!track) return false;

    const capabilities = track.getCapabilities?.() as any;
    
    if (capabilities?.focusMode?.includes('single-shot')) {
      await track.applyConstraints({
        advanced: [{ focusMode: 'single-shot' } as any]
      });
      
      // Return to continuous after 300ms
      setTimeout(async () => {
        if (capabilities.focusMode.includes('continuous')) {
          await track.applyConstraints({
            advanced: [{ focusMode: 'continuous' } as any]
          });
        }
      }, 300);
      
      return true;
    }
    return false;
  } catch (e) {
    console.log('Fast focus trigger not available:', e);
    return false;
  }
};

// Anti-glare image processing
export const applyAntiGlare = (
  ctx: CanvasRenderingContext2D, 
  canvas: HTMLCanvasElement,
  intensity: number = 0.3
): void => {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  // Detect and reduce glare hotspots
  const glareThreshold = 245; // Near-white pixels
  const reductionFactor = 1 - intensity;
  
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    // Check if pixel is a glare hotspot (very bright, low saturation)
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    
    if (max > glareThreshold && saturation < 0.15) {
      // Reduce brightness of glare spots
      const avg = (r + g + b) / 3;
      const targetBrightness = avg * reductionFactor + (255 - avg) * 0.5;
      
      data[i] = Math.min(255, r * reductionFactor + targetBrightness * 0.3);
      data[i + 1] = Math.min(255, g * reductionFactor + targetBrightness * 0.3);
      data[i + 2] = Math.min(255, b * reductionFactor + targetBrightness * 0.3);
    }
  }
  
  ctx.putImageData(imageData, 0, 0);
};

// Enhanced contrast for better OCR
export const enhanceForOCR = (
  ctx: CanvasRenderingContext2D, 
  canvas: HTMLCanvasElement
): void => {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  // Apply subtle contrast enhancement (contrast value: -255 to 255, using 20 for subtle boost)
  const contrast = 20;
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.max(0, factor * (data[i] - 128) + 128));
    data[i + 1] = Math.min(255, Math.max(0, factor * (data[i + 1] - 128) + 128));
    data[i + 2] = Math.min(255, Math.max(0, factor * (data[i + 2] - 128) + 128));
  }
  
  ctx.putImageData(imageData, 0, 0);
};

// Capture photo with maximum quality and anti-glare
export const captureMaxQualityPhoto = (
  video: HTMLVideoElement,
  options: {
    applyAntiGlareFilter?: boolean;
    enhanceOCR?: boolean;
    quality?: number;
    targetAspectRatio?: number;
  } = {}
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    // Validate video is ready with valid dimensions
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      console.error('Video not ready for capture:', {
        video: !!video,
        width: video?.videoWidth,
        height: video?.videoHeight,
        readyState: video?.readyState,
      });
      reject(new Error('Video not ready for capture. Please wait for camera to initialize.'));
      return;
    }

    const {
      applyAntiGlareFilter = true,
      enhanceOCR = false, // Disabled by default to avoid color issues
      quality = 0.98,
      targetAspectRatio,
    } = options;

    const canvas = document.createElement('canvas');
    
    // Use maximum available resolution
    let captureWidth = video.videoWidth;
    let captureHeight = video.videoHeight;
    
    // Apply target aspect ratio cropping if specified
    if (targetAspectRatio) {
      const videoRatio = captureWidth / captureHeight;
      if (videoRatio > targetAspectRatio) {
        captureWidth = Math.round(captureHeight * targetAspectRatio);
      } else {
        captureHeight = Math.round(captureWidth / targetAspectRatio);
      }
    }
    
    canvas.width = captureWidth;
    canvas.height = captureHeight;
    
    const ctx = canvas.getContext('2d', {
      alpha: false,
      desynchronized: true,
      willReadFrequently: applyAntiGlareFilter || enhanceOCR,
    });
    
    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }
    
    // High-quality rendering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // Calculate crop offset for aspect ratio
    const offsetX = (video.videoWidth - captureWidth) / 2;
    const offsetY = (video.videoHeight - captureHeight) / 2;
    
    // Draw video frame
    ctx.drawImage(
      video,
      offsetX, offsetY, captureWidth, captureHeight,
      0, 0, captureWidth, captureHeight
    );
    
    // Apply anti-glare filter
    if (applyAntiGlareFilter) {
      applyAntiGlare(ctx, canvas, 0.25);
    }
    
    // Enhance for OCR
    if (enhanceOCR) {
      enhanceForOCR(ctx, canvas);
    }
    
    // Export as high-quality JPEG
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create blob'));
        }
      },
      'image/jpeg',
      quality
    );
  });
};

// Get camera stream with maximum settings
export const getMaxQualityStream = async (
  facingMode: 'environment' | 'user' = 'environment',
  deviceId?: string
): Promise<MediaStream> => {
  const constraintOptions = getMaxCameraConstraints(facingMode, deviceId);
  
  let stream: MediaStream | null = null;
  let lastError: Error | null = null;

  for (const constraints of constraintOptions) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('Camera started with resolution:', 
        stream.getVideoTracks()[0]?.getSettings?.()?.width,
        'x',
        stream.getVideoTracks()[0]?.getSettings?.()?.height
      );
      break;
    } catch (err: any) {
      lastError = err;
      console.warn('Camera constraint failed, trying fallback:', err.name);
    }
  }

  if (!stream) {
    throw lastError || new Error('Failed to access camera');
  }

  // Apply fast autofocus
  await applyFastAutofocus(stream);

  return stream;
};
