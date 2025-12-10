import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import { useCameraZoom } from "./use-camera-zoom";
import { 
  getMaxQualityStream, 
  captureMaxQualityPhoto, 
  applyFastAutofocus,
  triggerFastFocus 
} from "@/lib/camera-optimizations";

interface UseCameraCaptureOptions {
  onCapture: (file: File) => void;
}

export function useCameraCapture({ onCapture }: UseCameraCaptureOptions) {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<'environment' | 'user'>('environment');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Zoom controls
  const { zoomLevel, zoomCapabilities, detectZoomCapabilities, setZoom, zoomIn, zoomOut, resetZoom } = useCameraZoom({
    streamRef,
  });

  const startCamera = useCallback(async (facingMode: 'environment' | 'user' = cameraFacingMode) => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      // Use maximum quality stream with fast autofocus
      const stream = await getMaxQualityStream(facingMode);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        
        await new Promise<void>((resolve) => {
          if (!videoRef.current) {
            resolve();
            return;
          }
          videoRef.current.onloadedmetadata = () => resolve();
          videoRef.current.onerror = () => resolve();
          setTimeout(() => resolve(), 3000);
        });
        
        try {
          await videoRef.current.play();
        } catch {
          // Continue - some browsers need user interaction
        }
        
        streamRef.current = stream;
        setIsCameraActive(true);
        setCameraFacingMode(facingMode);
        detectZoomCapabilities();
        
        // Log actual resolution
        const settings = stream.getVideoTracks()[0]?.getSettings?.();
        console.log(`Camera ready: ${settings?.width}x${settings?.height}`);
        toast.success(`Camera ready (${settings?.width}x${settings?.height})`);
      }
    } catch (error: any) {
      console.error('Camera error:', error);
      
      const messages: Record<string, string> = {
        NotAllowedError: 'Camera permission denied. Please allow camera access.',
        NotFoundError: 'No camera found on this device.',
        NotReadableError: 'Camera is in use by another application.',
        OverconstrainedError: 'Camera settings not supported.',
      };
      
      toast.error(messages[error.name] || `Camera error: ${error.message}`);
    }
  }, [cameraFacingMode]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  }, []);

  const toggleCamera = useCallback(() => {
    const newMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
    startCamera(newMode);
  }, [cameraFacingMode, startCamera]);

  // Trigger fast focus before capture
  const triggerFocus = useCallback(async () => {
    if (streamRef.current) {
      const success = await triggerFastFocus(streamRef.current);
      if (success) {
        toast.success('Focus triggered');
      }
    }
  }, []);

  const capturePhoto = useCallback(async () => {
    if (!videoRef.current) return;

    try {
      // Trigger fast focus before capture
      if (streamRef.current) {
        await triggerFastFocus(streamRef.current);
        // Brief delay for focus to settle
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      // Capture with anti-glare and OCR enhancement
      const blob = await captureMaxQualityPhoto(videoRef.current, {
        applyAntiGlareFilter: true,
        enhanceOCR: true,
        quality: 0.98,
      });

      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
      onCapture(file);
      stopCamera();
      toast.success('Photo captured!');
    } catch (error: any) {
      console.error('Capture error:', error);
      toast.error('Failed to capture photo');
    }
  }, [onCapture, stopCamera]);

  return {
    isCameraActive,
    cameraFacingMode,
    videoRef,
    startCamera,
    stopCamera,
    toggleCamera,
    capturePhoto,
    triggerFocus,
    // Zoom controls
    zoomLevel,
    zoomCapabilities,
    zoomIn,
    zoomOut,
    setZoom,
    resetZoom,
  };
}
