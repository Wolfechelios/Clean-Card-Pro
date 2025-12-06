import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";

interface UseCameraCaptureOptions {
  onCapture: (file: File) => void;
}

export function useCameraCapture({ onCapture }: UseCameraCaptureOptions) {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState<'environment' | 'user'>('environment');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(async (facingMode: 'environment' | 'user' = cameraFacingMode) => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      // Progressive fallback chain for camera constraints
      const constraintOptions = [
        {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        },
        {
          video: { facingMode: facingMode },
          audio: false,
        },
        { video: true, audio: false },
      ];

      let stream: MediaStream | null = null;
      let lastError: Error | null = null;

      for (const constraints of constraintOptions) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err: any) {
          lastError = err;
          console.warn('Camera constraint failed, trying fallback:', err.name);
        }
      }

      if (!stream) {
        throw lastError || new Error('Failed to access camera');
      }
      
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
        toast.success('Camera ready');
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

  const capturePhoto = useCallback(() => {
    if (!videoRef.current) return;

    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(videoRef.current, 0, 0);
      
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
          onCapture(file);
          stopCamera();
          toast.success('Photo captured!');
        }
      }, 'image/jpeg', 0.98);
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
  };
}
