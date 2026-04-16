// src/hooks/use-clarity-zoom.ts
// Auto zoom-out when image clarity drops (cards stacking closer to camera)

import { useCallback, useRef } from "react";

interface ClarityZoomOptions {
  /** Current zoom level */
  zoomLevel: number;
  /** Min zoom (can't go below) */
  minZoom: number;
  /** How much to zoom out per step */
  zoomOutStep?: number;
  /** Clarity threshold (0-1) - below this triggers zoom out */
  clarityThreshold?: number;
  /** Callback to set zoom */
  setZoom: (level: number) => Promise<boolean> | boolean;
  /** Whether auto zoom is enabled */
  enabled?: boolean;
}

/**
 * Measures image sharpness using Laplacian variance
 * Higher = sharper, lower = blurrier
 */
function measureClarity(imageData: ImageData): number {
  const { data, width, height } = imageData;
  
  // Convert to grayscale and apply Laplacian kernel
  const gray: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  
  // Laplacian kernel: [[0,1,0],[1,-4,1],[0,1,0]]
  let variance = 0;
  let count = 0;
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const laplacian = 
        gray[idx - width] + 
        gray[idx - 1] + 
        gray[idx + 1] + 
        gray[idx + width] - 
        4 * gray[idx];
      
      variance += laplacian * laplacian;
      count++;
    }
  }
  
  // Normalize to 0-1 range (typical values 0-1000+)
  const rawVariance = count > 0 ? variance / count : 0;
  // Map to 0-1 scale (500+ is very sharp)
  return Math.min(1, rawVariance / 500);
}

/**
 * Hook for auto zoom-out based on image clarity
 * Detects when cards are too close (blurry) and zooms out automatically
 */
export function useClarityZoom({
  zoomLevel,
  minZoom,
  zoomOutStep = 0.15,
  clarityThreshold = 0.25,
  setZoom,
  enabled = true,
}: ClarityZoomOptions) {
  const lastClarityRef = useRef<number>(1);
  const consecutiveBlurryRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  
  /**
   * Analyze a video frame for clarity and auto-zoom if needed
   * Call this after each capture
   */
  const analyzeAndAdjustZoom = useCallback(
    async (video: HTMLVideoElement): Promise<{ clarity: number; zoomedOut: boolean }> => {
      if (!enabled || !video || video.videoWidth === 0) {
        return { clarity: 1, zoomedOut: false };
      }
      
      // Sample at lower resolution for speed
      const sampleWidth = 320;
      const sampleHeight = Math.round((video.videoHeight / video.videoWidth) * sampleWidth);
      
      // Reuse canvas
      if (!canvasRef.current) {
        canvasRef.current = document.createElement("canvas");
      }
      const canvas = canvasRef.current;
      
      if (canvas.width !== sampleWidth || canvas.height !== sampleHeight) {
        canvas.width = sampleWidth;
        canvas.height = sampleHeight;
        ctxRef.current = canvas.getContext("2d", { willReadFrequently: true });
      }
      
      const ctx = ctxRef.current;
      if (!ctx) return { clarity: 1, zoomedOut: false };
      
      // Draw video frame
      ctx.drawImage(video, 0, 0, sampleWidth, sampleHeight);
      
      // Measure center region only (where card should be)
      const regionX = Math.round(sampleWidth * 0.25);
      const regionY = Math.round(sampleHeight * 0.25);
      const regionW = Math.round(sampleWidth * 0.5);
      const regionH = Math.round(sampleHeight * 0.5);
      
      const imageData = ctx.getImageData(regionX, regionY, regionW, regionH);
      const clarity = measureClarity(imageData);
      
      lastClarityRef.current = clarity;
      
      // Check if we should zoom out
      let zoomedOut = false;
      
      if (clarity < clarityThreshold && zoomLevel > minZoom) {
        consecutiveBlurryRef.current++;
        
        // Require 2 consecutive blurry frames to avoid false positives
        if (consecutiveBlurryRef.current >= 2) {
          const newZoom = Math.max(minZoom, zoomLevel - zoomOutStep);
          await setZoom(newZoom);
          consecutiveBlurryRef.current = 0;
          zoomedOut = true;
          console.log(`[ClarityZoom] Auto zoom-out: ${zoomLevel.toFixed(1)}x → ${newZoom.toFixed(1)}x (clarity: ${clarity.toFixed(2)})`);
        }
      } else {
        consecutiveBlurryRef.current = 0;
      }
      
      return { clarity, zoomedOut };
    },
    [enabled, zoomLevel, minZoom, zoomOutStep, clarityThreshold, setZoom]
  );
  
  /**
   * Reset tracking state (call when camera restarts)
   */
  const reset = useCallback(() => {
    lastClarityRef.current = 1;
    consecutiveBlurryRef.current = 0;
  }, []);
  
  return {
    analyzeAndAdjustZoom,
    lastClarity: lastClarityRef.current,
    reset,
  };
}
