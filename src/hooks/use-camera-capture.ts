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
        
        // Wait for video to be ready to play
        await new Promise<void>((resolve, reject) => {
          if (!videoRef.current) {
            reject(new Error('Video element not found'));
            return;
          }
          
          const video = videoRef.current;
          
          const onCanPlay = () => {
            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('error', onError);
            clearTimeout(timeout);
            resolve();
          };
          
          const onError = (e: Event) => {
            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('error', onError);
            clearTimeout(timeout);
            reject(new Error('Video failed to load'));
          };
          
          // Check if already ready
          if (video.readyState >= 3) {
            resolve();
            return;
          }
          
          video.addEventListener('canplay', onCanPlay);
          video.addEventListener('error', onError);
          
          const timeout = setTimeout(() => {
            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('error', onError);
            // Resolve anyway after timeout - video might still work
            resolve();
          }, 5000);
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
  }, [cameraFacingMode, detectZoomCapabilities]);

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
    if (!videoRef.current) {
      toast.error('Camera not initialized');
      return;
    }

    // Check if video is ready
    if (videoRef.current.readyState < 2 || videoRef.current.videoWidth === 0) {
      toast.error('Camera not ready. Please wait and try again.');
      console.error('Video not ready:', {
        readyState: videoRef.current.readyState,
        videoWidth: videoRef.current.videoWidth,
        videoHeight: videoRef.current.videoHeight,
      });
      return;
    }

    try {
      // Trigger fast focus before capture
      if (streamRef.current) {
        await triggerFastFocus(streamRef.current);
        // Brief delay for focus to settle
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      // Capture with anti-glare, disable OCR enhancement to avoid color issues
      const blob = await captureMaxQualityPhoto(videoRef.current, {
        applyAntiGlareFilter: true,
        enhanceOCR: false,
        quality: 0.98,
      });

      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
      onCapture(file);
      stopCamera();
      toast.success('Photo captured!');
    } catch (error: any) {
      console.error('Capture error:', error);
      toast.error(error.message || 'Failed to capture photo');
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
