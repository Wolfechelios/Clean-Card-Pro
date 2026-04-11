import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import { useCameraZoom } from "./use-camera-zoom";
import { 
  captureMaxQualityPhoto, 
  applyFastAutofocus,
  triggerFastFocus,
  getMaxCameraConstraints,
} from "@/lib/camera-optimizations";
import { playShutterBeep } from "@/lib/audioBeeps";

interface UseCameraCaptureOptions {
  onCapture: (file: File) => void;
}

export function useCameraCapture({ onCapture }: UseCameraCaptureOptions) {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const cameraFacingMode = 'environment' as const;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Zoom controls
  const { zoomLevel, zoomCapabilities, detectZoomCapabilities, setZoom, zoomIn, zoomOut, resetZoom } = useCameraZoom({
    streamRef,
  });

  const startCamera = useCallback(async (facingMode: 'environment' = 'environment') => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      // Use optimized constraints from camera-optimizations library
      const constraintOptions = getMaxCameraConstraints(facingMode);

      let stream: MediaStream | null = null;
      let lastError: Error | null = null;

      for (const constraints of constraintOptions) {
        try {
          console.log('Trying camera constraints:', constraints);
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          console.log('Camera started successfully');
          break;
        } catch (err: any) {
          lastError = err;
          console.warn('Camera constraint failed, trying fallback:', err.name, err.message);
        }
      }

      if (!stream) {
        throw lastError || new Error('Failed to access camera');
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        streamRef.current = stream;
        
        // Wait for video to be ready to play
        await new Promise<void>((resolve, reject) => {
          if (!videoRef.current) {
            reject(new Error('Video element not found'));
            return;
          }
          
          const video = videoRef.current;
          
          const onLoadedMetadata = () => {
            video.removeEventListener('loadedmetadata', onLoadedMetadata);
            video.removeEventListener('error', onError);
            clearTimeout(timeout);
            
            video.play()
              .then(() => resolve())
              .catch(() => resolve()); // Continue anyway
          };
          
          const onError = () => {
            video.removeEventListener('loadedmetadata', onLoadedMetadata);
            video.removeEventListener('error', onError);
            clearTimeout(timeout);
            reject(new Error('Video failed to load'));
          };
          
          // Check if already ready
          if (video.readyState >= 2) {
            video.play().then(() => resolve()).catch(() => resolve());
            return;
          }
          
          video.addEventListener('loadedmetadata', onLoadedMetadata);
          video.addEventListener('error', onError);
          
          const timeout = setTimeout(() => {
            video.removeEventListener('loadedmetadata', onLoadedMetadata);
            video.removeEventListener('error', onError);
            // Try to play anyway after timeout
            video.play().then(() => resolve()).catch(() => resolve());
          }, 5000);
        });
        
      setIsCameraActive(true);
        
        // Apply fast autofocus
        try {
          await applyFastAutofocus(stream);
        } catch (e) {
          console.log('Autofocus not available');
        }
        
        detectZoomCapabilities();
        
        // Log actual resolution
        const settings = stream.getVideoTracks()[0]?.getSettings?.();
        console.log(`Camera ready: ${settings?.width}x${settings?.height}`);
        toast.success(`Camera ready`);
      }
    } catch (error: any) {
      console.error('Camera error:', error);
      
      const messages: Record<string, string> = {
        NotAllowedError: 'Camera permission denied. Please allow camera access in your browser settings.',
        NotFoundError: 'No camera found on this device.',
        NotReadableError: 'Camera is in use by another application.',
        OverconstrainedError: 'Camera settings not supported.',
        AbortError: 'Camera access was aborted.',
        SecurityError: 'Camera access blocked due to security settings.',
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

  // Front camera disabled — only rear camera allowed
  const toggleCamera = useCallback(() => {
    // No-op: front camera is disabled for card scanning
  }, []);

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
