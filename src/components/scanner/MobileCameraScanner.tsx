import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, SwitchCamera, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useCameraDevices } from "@/hooks/use-camera-devices";
import { CameraDeviceSelector } from "./CameraDeviceSelector";

interface MobileCameraScannerProps {
  userId: string;
  onImageCaptured: (imageFile: File) => void;
}

export const MobileCameraScanner = ({ userId, onImageCaptured }: MobileCameraScannerProps) => {
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [isInitializing, setIsInitializing] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const { devices, selectedDeviceId, setSelectedDeviceId, isLoading: devicesLoading, refreshDevices } = useCameraDevices();

  const startCamera = async (facing: 'environment' | 'user' = cameraFacing, deviceId?: string) => {
    try {
      console.log("=== CAMERA START ===");
      console.log("Facing mode:", facing);
      console.log("Is secure context:", window.isSecureContext);
      console.log("Navigator mediaDevices:", !!navigator.mediaDevices);
      
      setCameraError(null);
      setIsInitializing(true);

      // Stop any existing stream
      if (streamRef.current) {
        console.log("Stopping existing stream");
        streamRef.current.getTracks().forEach(track => {
          console.log("Stopping track:", track.kind, track.label);
          track.stop();
        });
      }

      // Check for camera support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera not supported in this browser");
      }

      let stream: MediaStream | null = null;
      const targetDeviceId = deviceId || selectedDeviceId;

      // Try multiple constraint strategies for better compatibility
      const constraintStrategies = targetDeviceId ? [
        // Strategy 0: Use specific device ID (for USB cameras)
        {
          video: {
            deviceId: { exact: targetDeviceId },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        },
        {
          video: {
            deviceId: targetDeviceId,
          },
          audio: false
        },
      ] : [
        // Strategy 1: Exact facingMode (works best on modern mobile browsers)
        {
          video: {
            facingMode: { exact: facing },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        },
        // Strategy 2: Ideal facingMode (more flexible)
        {
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        },
        // Strategy 3: Simple facingMode string
        {
          video: {
            facingMode: facing,
          },
          audio: false
        },
        // Strategy 4: No facingMode, just request video (fallback)
        {
          video: true,
          audio: false
        }
      ];

      // Try each strategy until one works
      for (let i = 0; i < constraintStrategies.length; i++) {
        const constraints = constraintStrategies[i];
        console.log(`Trying strategy ${i + 1}:`, JSON.stringify(constraints));
        
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          console.log(`Strategy ${i + 1} succeeded!`);
          break;
        } catch (err: any) {
          console.log(`Strategy ${i + 1} failed:`, err.name, err.message);
          if (i === constraintStrategies.length - 1) {
            // Last strategy failed, throw the error
            throw err;
          }
          // Continue to next strategy
        }
      }

      if (!stream) {
        throw new Error("Failed to get camera stream with all strategies");
      }
      console.log("Camera access granted!");
      console.log("Stream tracks:", stream.getTracks().map(t => ({ kind: t.kind, label: t.label, enabled: t.enabled })));

      if (!videoRef.current) {
        console.error("Video element not found!");
        throw new Error("Video element not ready");
      }

      // Set up video element with mobile-specific attributes
      videoRef.current.srcObject = stream;
      videoRef.current.playsInline = true;
      videoRef.current.autoplay = true;
      videoRef.current.muted = true;
      videoRef.current.setAttribute('playsinline', 'true');
      videoRef.current.setAttribute('autoplay', 'true');
      videoRef.current.setAttribute('muted', 'true');
      videoRef.current.setAttribute('webkit-playsinline', 'true'); // iOS Safari
      
      // Force styles for Android compatibility
      videoRef.current.style.width = '100%';
      videoRef.current.style.height = '100%';
      videoRef.current.style.objectFit = 'cover';

      // Wait for video to be ready
      await new Promise((resolve, reject) => {
        if (!videoRef.current) {
          reject(new Error("Video element lost"));
          return;
        }

        videoRef.current.onloadedmetadata = () => {
          console.log("Video metadata loaded");
          console.log("Video dimensions:", videoRef.current?.videoWidth, "x", videoRef.current?.videoHeight);
          resolve(null);
        };

        videoRef.current.onerror = (e) => {
          console.error("Video element error:", e);
          reject(new Error("Video element failed to load"));
        };

        // Timeout after 10 seconds
        setTimeout(() => reject(new Error("Video loading timeout")), 10000);
      });

      // Play the video with error handling
      console.log("Playing video...");
      try {
        await videoRef.current.play();
      } catch (playError: any) {
        console.error("Play error:", playError);
        // On some mobile browsers, play() might fail initially but work after user interaction
        // We'll still mark it as ready since the stream is active
      }
      console.log("Video setup complete");

      streamRef.current = stream;
      setCameraFacing(facing);
      setCameraReady(true);
      setIsInitializing(false);
      toast.success("Camera ready!");
      
    } catch (error: any) {
      console.error("=== CAMERA ERROR ===");
      console.error("Error name:", error.name);
      console.error("Error message:", error.message);
      console.error("Full error:", error);
      
      setIsInitializing(false);
      setCameraReady(false);
      
      let errorMessage = "Failed to access camera";
      
      if (error.name === 'NotAllowedError') {
        errorMessage = "Camera permission denied. Please allow camera access in your browser settings.";
      } else if (error.name === 'NotFoundError') {
        errorMessage = "No camera found on this device";
      } else if (error.name === 'NotReadableError') {
        errorMessage = "Camera is already in use by another app. Please close other apps and try again.";
      } else if (error.name === 'NotSupportedError') {
        errorMessage = "Camera not supported. Make sure you're using HTTPS and a modern browser.";
      } else if (error.name === 'OverconstrainedError') {
        errorMessage = "Camera constraints not supported on this device. Trying fallback...";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      setCameraError(errorMessage);
      toast.error(errorMessage);
    }
  };

  const toggleCamera = () => {
    const newFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    startCamera(newFacing);
  };

  const handleDeviceChange = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    startCamera(cameraFacing, deviceId);
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !cameraReady) {
      toast.error("Camera not ready");
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error("Failed to get canvas context");
      
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(videoRef.current, 0, 0);
      
      // Convert to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error("Failed to create blob"));
        }, 'image/jpeg', 0.95);
      });
      
      const file = new File([blob], `card-${Date.now()}.jpg`, { type: 'image/jpeg' });
      onImageCaptured(file);
      toast.success("Photo captured!");
      
    } catch (error: any) {
      console.error("Capture error:", error);
      toast.error("Failed to capture photo");
    }
  };

  useEffect(() => {
    startCamera();
    
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>Mobile Camera</CardTitle>
        <CardDescription>
          {isInitializing && "Initializing camera..."}
          {cameraReady && "Camera ready - tap to capture cards"}
          {cameraError && "Camera error - see below"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {devices.length > 1 && (
          <CameraDeviceSelector
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            onDeviceChange={handleDeviceChange}
            onRefresh={refreshDevices}
            isLoading={devicesLoading}
          />
        )}
        
        <div className="relative aspect-[3/4] bg-black rounded-lg overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          
          {isInitializing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="text-center text-white">
                <Loader2 className="h-12 w-12 animate-spin mx-auto mb-2" />
                <p>Starting camera...</p>
              </div>
            </div>
          )}

          {cameraError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4">
              <div className="text-center text-white">
                <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
                <p className="text-lg font-semibold mb-2">Camera Error</p>
                <p className="text-sm mb-4">{cameraError}</p>
                <Button onClick={() => startCamera()} variant="secondary">
                  Try Again
                </Button>
              </div>
            </div>
          )}
          
          {cameraReady && (
            <Button
              onClick={toggleCamera}
              variant="secondary"
              size="icon"
              className="absolute top-4 right-4 rounded-full bg-black/70 hover:bg-black/80"
            >
              <SwitchCamera className="h-5 w-5 text-white" />
            </Button>
          )}
        </div>

        {cameraReady && (
          <Button 
            onClick={capturePhoto} 
            size="lg" 
            className="w-full"
          >
            <Camera className="mr-2 h-5 w-5" />
            Capture Card
          </Button>
        )}

        <div className="text-xs text-muted-foreground space-y-1">
          <p>• Allow camera permissions when prompted</p>
          <p>• Make sure no other app is using the camera</p>
          <p>• Use a secure connection (HTTPS)</p>
          <p>• Try closing and reopening your browser if issues persist</p>
        </div>
      </CardContent>
    </Card>
  );
};
