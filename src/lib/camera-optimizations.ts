/**
 * Ultra-optimized camera settings for maximum quality card scanning
 * - 8K/4K resolution support
 * - Fast continuous autofocus
 * - Anti-glare image processing
 * - GPU-first execution with fallback
 * - Buffer reuse for memory efficiency
 */

import { GPU_CONFIG } from "@/lib/performance/gpuConfig";
import { MEMORY_CONFIG } from "@/lib/performance/memoryConfig";
import { canProcessFrame, markFrameStart, markFrameEnd } from "@/lib/performance/pipelineGuards";

export interface OptimizedCameraConstraints {
  video: MediaTrackConstraints;
  audio: false;
}

// Shared canvas/context for buffer reuse when MEMORY_CONFIG.reuseBuffers is true
let sharedCanvas: HTMLCanvasElement | null = null;
let sharedCtx: CanvasRenderingContext2D | null = null;

function getReusableCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  if (MEMORY_CONFIG.reuseBuffers && sharedCanvas && sharedCtx) {
    if (sharedCanvas.width !== width || sharedCanvas.height !== height) {
      sharedCanvas.width = width;
      sharedCanvas.height = height;
    }
    return { canvas: sharedCanvas, ctx: sharedCtx };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  // Use GPU-first rendering hints when available
  const ctxOptions: CanvasRenderingContext2DSettings = {
    alpha: false,
    desynchronized: GPU_CONFIG.execution === "gpu-first",
    willReadFrequently: false,
  };

  const ctx = canvas.getContext('2d', ctxOptions);
  if (!ctx) throw new Error('Failed to get canvas context');

  if (MEMORY_CONFIG.reuseBuffers) {
    sharedCanvas = canvas;
    sharedCtx = ctx;
  }

  return { canvas, ctx };
}

// Maximum resolution camera constraints with progressive fallback
export const getMaxCameraConstraints = (facingMode: 'environment' | 'user' = 'environment', deviceId?: string): OptimizedCameraConstraints[] => {
  const baseConstraints = deviceId 
    ? { deviceId: { exact: deviceId } }
    : { facingMode: { exact: facingMode } };

  // Advanced hardware hints for rear camera quality
  const advancedHints: any = {
    focusMode: { ideal: 'continuous' },
    exposureMode: { ideal: 'continuous' },
    whiteBalanceMode: { ideal: 'continuous' },
    // Reduce noise at hardware level
    ...(typeof (window as any).MediaStreamTrack !== 'undefined' ? {
      noiseSuppression: { ideal: true },
    } : {}),
  };

  return [
    // Try 1: 8K Ultra HD (7680x4320)
    {
      video: {
        ...baseConstraints,
        ...advancedHints,
        width: { ideal: 7680, min: 3840 },
        height: { ideal: 4320, min: 2160 },
        frameRate: { ideal: 30, min: 15 },
        aspectRatio: { ideal: 4/3 }, // 4:3 captures more card detail than 16:9
        resizeMode: { ideal: 'none' } as any, // Prevent downscaling
      },
      audio: false as const,
    },
    // Try 2: 4K UHD (3840x2160)
    {
      video: {
        ...baseConstraints,
        ...advancedHints,
        width: { ideal: 3840, min: 1920 },
        height: { ideal: 2880, min: 1440 }, // 4:3 aspect
        frameRate: { ideal: 30 },
        resizeMode: { ideal: 'none' } as any,
      },
      audio: false as const,
    },
    // Try 3: 2K QHD (2560x1920 in 4:3)
    {
      video: {
        ...baseConstraints,
        ...advancedHints,
        width: { ideal: 2560 },
        height: { ideal: 1920 },
        frameRate: { ideal: 30 },
      },
      audio: false as const,
    },
    // Try 4: Full HD (1920x1440 in 4:3, fallback 1920x1080)
    {
      video: {
        ...baseConstraints,
        ...advancedHints,
        width: { ideal: 1920 },
        height: { ideal: 1440 },
      },
      audio: false as const,
    },
    // Try 5: HD
    {
      video: {
        ...baseConstraints,
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
      audio: false as const,
    },
    // Fallback: Any rear camera
    {
      video: deviceId ? { deviceId } : { facingMode },
      audio: false as const,
    },
  ];
};

// Apply fast continuous autofocus with macro support
export const applyFastAutofocus = async (stream: MediaStream, enableMacro: boolean = true): Promise<void> => {
  try {
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    const capabilities = track.getCapabilities?.() as any;
    
    // Build a single advanced constraints batch for maximum hardware quality
    const advancedBatch: any[] = [];

    // 1. Continuous autofocus with macro support
    if (capabilities?.focusMode?.includes('continuous')) {
      advancedBatch.push({ focusMode: 'continuous' });
      
      if (enableMacro && capabilities.focusDistance) {
        const minDist = capabilities.focusDistance.min;
        advancedBatch.push({ focusDistance: minDist });
        console.log(`Macro focus enabled: min distance ${minDist}`);
      }
    }

    // 2. Continuous auto-exposure
    if (capabilities?.exposureMode?.includes('continuous')) {
      advancedBatch.push({ exposureMode: 'continuous' });
    }

    // 3. Continuous auto white balance
    if (capabilities?.whiteBalanceMode?.includes('continuous')) {
      advancedBatch.push({ whiteBalanceMode: 'continuous' });
    }

    // 4. Exposure compensation (+0.3 EV for card text legibility)
    if (capabilities?.exposureCompensation) {
      const maxComp = capabilities.exposureCompensation.max || 2;
      const step = capabilities.exposureCompensation.step || 0.1;
      const targetComp = Math.min(0.3, maxComp);
      const snapped = Math.round(targetComp / step) * step;
      advancedBatch.push({ exposureCompensation: snapped });
      console.log(`Exposure compensation: +${snapped} EV`);
    }

    // 5. Sharpness — maximize if hardware supports it
    if (capabilities?.sharpness) {
      const maxSharpness = capabilities.sharpness.max ?? 100;
      advancedBatch.push({ sharpness: maxSharpness });
      console.log(`Sharpness set to max: ${maxSharpness}`);
    }

    // 6. Contrast boost for card detail
    if (capabilities?.contrast) {
      const maxContrast = capabilities.contrast.max ?? 100;
      const midHigh = Math.round(maxContrast * 0.7); // 70% — punchy without clipping
      advancedBatch.push({ contrast: midHigh });
      console.log(`Contrast set to: ${midHigh}`);
    }

    // 7. Saturation — slight boost for vivid card art
    if (capabilities?.saturation) {
      const maxSat = capabilities.saturation.max ?? 100;
      const target = Math.round(maxSat * 0.6); // 60% — natural but vivid
      advancedBatch.push({ saturation: target });
    }

    // 8. ISO — keep as low as possible for minimal noise
    if (capabilities?.iso) {
      const minISO = capabilities.iso.min ?? 50;
      advancedBatch.push({ iso: minISO });
      console.log(`ISO set to minimum: ${minISO}`);
    }

    // Apply all hardware tuning in one call
    if (advancedBatch.length > 0) {
      try {
        await track.applyConstraints({ advanced: advancedBatch });
        console.log(`Applied ${advancedBatch.length} camera hardware optimizations`);
      } catch (e) {
        // If batch fails, apply individually
        console.warn('Batch constraints failed, applying individually');
        for (const constraint of advancedBatch) {
          try {
            await track.applyConstraints({ advanced: [constraint] });
          } catch { /* best effort */ }
        }
      }
    }

    // 9. Color temperature — try manual 5500K for neutral card colors
    if (capabilities?.colorTemperature && capabilities?.whiteBalanceMode?.includes('manual')) {
      const min = capabilities.colorTemperature.min || 2500;
      const max = capabilities.colorTemperature.max || 10000;
      const target = Math.min(Math.max(5500, min), max);
      try {
        await track.applyConstraints({
          advanced: [
            { whiteBalanceMode: 'manual' } as any,
            { colorTemperature: target } as any,
          ]
        });
        console.log(`Color temperature: ${target}K`);
      } catch {
        console.log('Manual color temp unavailable, using continuous WB');
      }
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

// Auto white balance correction for captured images
// Applies gray-world assumption to neutralize color casts
export const applyAutoColorBalance = (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  strength: number = 0.6
): void => {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const pixelCount = data.length / 4;

  // Calculate average R, G, B across the entire image
  let totalR = 0, totalG = 0, totalB = 0;
  for (let i = 0; i < data.length; i += 4) {
    totalR += data[i];
    totalG += data[i + 1];
    totalB += data[i + 2];
  }

  const avgR = totalR / pixelCount;
  const avgG = totalG / pixelCount;
  const avgB = totalB / pixelCount;

  // Gray-world: the average of all channels should be equal
  const avgGray = (avgR + avgG + avgB) / 3;

  // Avoid division by zero
  if (avgR === 0 || avgG === 0 || avgB === 0) return;

  const scaleR = 1 + (avgGray / avgR - 1) * strength;
  const scaleG = 1 + (avgGray / avgG - 1) * strength;
  const scaleB = 1 + (avgGray / avgB - 1) * strength;

  for (let i = 0; i < data.length; i += 4) {
    data[i]     = Math.min(255, Math.max(0, Math.round(data[i] * scaleR)));
    data[i + 1] = Math.min(255, Math.max(0, Math.round(data[i + 1] * scaleG)));
    data[i + 2] = Math.min(255, Math.max(0, Math.round(data[i + 2] * scaleB)));
  }

  ctx.putImageData(imageData, 0, 0);
};

// Capture photo with maximum quality and anti-glare
// Uses performance pipeline guards to limit in-flight frames
export const captureMaxQualityPhoto = async (
  video: HTMLVideoElement,
  options: {
    applyAntiGlareFilter?: boolean;
    enhanceOCR?: boolean;
    quality?: number;
    targetAspectRatio?: number;
  } = {}
): Promise<Blob> => {
  // Enforce max in-flight frames
  const maxWaitMs = 2000;
  const startWait = Date.now();
  while (!canProcessFrame()) {
    if (Date.now() - startWait > maxWaitMs) {
      console.warn('[captureMaxQualityPhoto] Frame slot timeout, proceeding anyway');
      break;
    }
    await new Promise(r => setTimeout(r, 16));
  }
  markFrameStart();

  try {
    // Validate video is ready with valid dimensions
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      console.error('Video not ready for capture:', {
        video: !!video,
        width: video?.videoWidth,
        height: video?.videoHeight,
        readyState: video?.readyState,
      });
      throw new Error('Video not ready for capture. Please wait for camera to initialize.');
    }

    const {
      applyAntiGlareFilter = true,
      enhanceOCR = false, // Disabled by default to avoid color issues
      quality = 0.98,
      targetAspectRatio,
    } = options;

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
    
    // Get canvas with buffer reuse if enabled
    const { canvas, ctx } = getReusableCanvas(captureWidth, captureHeight);
    
    // GPU-first: use desynchronized rendering for GPU acceleration
    // This is already set in getReusableCanvas based on GPU_CONFIG
    
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
    
    // Apply anti-glare filter (requires willReadFrequently)
    if (applyAntiGlareFilter) {
      applyAntiGlare(ctx, canvas, 0.25);
    }
    
    // Enhance for OCR
    if (enhanceOCR) {
      enhanceForOCR(ctx, canvas);
    }
    
    // Export as high-quality JPEG
    return new Promise<Blob>((resolve, reject) => {
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
  } finally {
    // Always release frame slot
    markFrameEnd();
  }
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
