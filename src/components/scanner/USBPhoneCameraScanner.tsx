import { useState, useRef, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, Loader2, AlertCircle, RefreshCw, Usb, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useCameraDevices } from "@/hooks/use-camera-devices";
import { CameraDeviceSelector } from "./CameraDeviceSelector";
import { Badge } from "@/components/ui/badge";

interface USBPhoneCameraScannerProps {
  onImageCaptured: (imageFile: File) => void;
}

export const USBPhoneCameraScanner = ({ onImageCaptured }: USBPhoneCameraScannerProps) => {
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const { devices, selectedDeviceId, setSelectedDeviceId, isLoading: devicesLoading, refreshDevices } = useCameraDevices();

  // Filter to show USB devices first
  const usbDevices = devices.filter(d => d.isUSB);
  const otherDevices = devices.filter(d => !d.isUSB);
  const sortedDevices = [...usbDevices, ...otherDevices];
  const hasUSBDevices = usbDevices.length > 0;

  const startCamera = useCallback(async (deviceId?: string) => {
    try {
      setCameraError(null);
      setIsInitializing(true);

      // Stop any existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera not supported in this browser");
      }

      const targetDeviceId = deviceId || selectedDeviceId;
      
      if (!targetDeviceId) {
        throw new Error("No camera device selected. Please connect a USB phone camera.");
      }

      // Try to get the specific USB device
      const constraints = {
        video: {
          deviceId: { exact: targetDeviceId },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      };

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        // Fallback to less strict constraints
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: targetDeviceId },
          audio: false
        });
      }

      if (!videoRef.current) {
        throw new Error("Video element not ready");
      }

      videoRef.current.srcObject = stream;
      videoRef.current.playsInline = true;
      videoRef.current.autoplay = true;
      videoRef.current.muted = true;

      await new Promise((resolve, reject) => {
        if (!videoRef.current) {
          reject(new Error("Video element lost"));
          return;
        }
        videoRef.current.onloadedmetadata = () => resolve(null);
        videoRef.current.onerror = () => reject(new Error("Video failed to load"));
        setTimeout(() => reject(new Error("Video loading timeout")), 10000);
      });

      await videoRef.current.play();

      streamRef.current = stream;
      setCameraReady(true);
      setIsInitializing(false);
      
      const selectedDevice = devices.find(d => d.deviceId === targetDeviceId);
      toast.success(`Connected to ${selectedDevice?.label || 'USB Camera'}`);
      
    } catch (error: any) {
      console.error("USB Camera error:", error);
      setIsInitializing(false);
      setCameraReady(false);
      
      let errorMessage = "Failed to access USB camera";
      if (error.name === 'NotAllowedError') {
        errorMessage = "Camera permission denied. Please allow camera access.";
      } else if (error.name === 'NotFoundError') {
        errorMessage = "USB camera not found. Make sure your phone is connected.";
      } else if (error.name === 'NotReadableError') {
        errorMessage = "Camera is in use by another app.";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      setCameraError(errorMessage);
      toast.error(errorMessage);
    }
  }, [selectedDeviceId, devices]);

  const handleDeviceChange = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (cameraReady || cameraError) {
      startCamera(deviceId);
    }
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
      
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error("Failed to create blob"));
        }, 'image/jpeg', 0.95);
      });
      
      const file = new File([blob], `card-usb-${Date.now()}.jpg`, { type: 'image/jpeg' });
      onImageCaptured(file);
      toast.success("Photo captured!");
      
    } catch (error: any) {
      console.error("Capture error:", error);
      toast.error("Failed to capture photo");
    }
  };

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
    setCameraError(null);
  }, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return (
    <Card className="shadow-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Usb className="h-5 w-5 text-primary" />
              USB Phone Camera
            </CardTitle>
            <CardDescription>
              Connect your phone via USB and use it as a high-quality scanner
            </CardDescription>
          </div>
          {hasUSBDevices && (
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              <Smartphone className="mr-1 h-3 w-3" />
              {usbDevices.length} USB device{usbDevices.length > 1 ? 's' : ''} found
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Device Selector */}
        <div className="flex items-center gap-2">
          <CameraDeviceSelector
            devices={sortedDevices}
            selectedDeviceId={selectedDeviceId}
            onDeviceChange={handleDeviceChange}
            onRefresh={refreshDevices}
            isLoading={devicesLoading}
            className="flex-1"
          />
        </div>

        {/* USB Connection Tips */}
        {!hasUSBDevices && !cameraReady && (
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <Usb className="h-4 w-4 text-primary" />
              Connect Your Phone
            </h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Install a USB webcam app on your phone (DroidCam, Iriun, Camo, EpocCam)</li>
              <li>• Connect your phone to your computer via USB</li>
              <li>• Open the app on your phone and enable USB mode</li>
              <li>• Click the refresh button to detect your phone camera</li>
            </ul>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshDevices}
              disabled={devicesLoading}
              className="mt-3"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${devicesLoading ? 'animate-spin' : ''}`} />
              Scan for Devices
            </Button>
          </div>
        )}

        {/* Camera Preview */}
        <div className="relative aspect-[3/4] bg-black rounded-lg overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          
          {!cameraReady && !isInitializing && !cameraError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80">
              <div className="text-center text-white p-4">
                <Usb className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="mb-4">Select a USB camera and click Start</p>
                <Button 
                  onClick={() => startCamera()} 
                  disabled={!selectedDeviceId}
                  variant="secondary"
                >
                  <Camera className="mr-2 h-4 w-4" />
                  Start Camera
                </Button>
              </div>
            </div>
          )}
          
          {isInitializing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="text-center text-white">
                <Loader2 className="h-12 w-12 animate-spin mx-auto mb-2" />
                <p>Connecting to USB camera...</p>
              </div>
            </div>
          )}

          {cameraError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4">
              <div className="text-center text-white">
                <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
                <p className="text-lg font-semibold mb-2">Connection Failed</p>
                <p className="text-sm mb-4">{cameraError}</p>
                <div className="flex gap-2 justify-center">
                  <Button onClick={refreshDevices} variant="outline" size="sm">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Refresh
                  </Button>
                  <Button onClick={() => startCamera()} variant="secondary" size="sm">
                    Try Again
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Card frame guide */}
          {cameraReady && (
            <div className="absolute inset-4 border-2 border-dashed border-primary/50 rounded-lg pointer-events-none">
              <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-primary rounded-tl" />
              <div className="absolute top-0 right-0 w-6 h-6 border-t-2 border-r-2 border-primary rounded-tr" />
              <div className="absolute bottom-0 left-0 w-6 h-6 border-b-2 border-l-2 border-primary rounded-bl" />
              <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-primary rounded-br" />
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          {cameraReady ? (
            <>
              <Button 
                onClick={capturePhoto} 
                size="lg" 
                className="flex-1"
              >
                <Camera className="mr-2 h-5 w-5" />
                Capture Card
              </Button>
              <Button 
                onClick={stopCamera} 
                variant="outline"
                size="lg"
              >
                Stop
              </Button>
            </>
          ) : (
            <Button 
              onClick={() => startCamera()} 
              size="lg" 
              className="w-full"
              disabled={!selectedDeviceId || isInitializing}
            >
              {isInitializing ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Camera className="mr-2 h-5 w-5" />
                  Start USB Camera
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
