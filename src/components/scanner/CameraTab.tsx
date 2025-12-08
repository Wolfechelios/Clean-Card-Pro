import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, SwitchCamera, X } from "lucide-react";
import { ZoomControls } from "./ZoomControls";

interface CameraTabProps {
  isCameraActive: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
  onStart: () => void;
  onStop: () => void;
  onToggle: () => void;
  onCapture: () => void;
  zoomLevel?: number;
  zoomCapabilities?: {
    supported: boolean;
    min: number;
    max: number;
  };
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomChange?: (level: number) => void;
  onZoomReset?: () => void;
}

export function CameraTab({
  isCameraActive,
  videoRef,
  onStart,
  onStop,
  onToggle,
  onCapture,
  zoomLevel = 1,
  zoomCapabilities = { supported: false, min: 1, max: 10 },
  onZoomIn = () => {},
  onZoomOut = () => {},
  onZoomChange = () => {},
  onZoomReset = () => {},
}: CameraTabProps) {
  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle>Camera Capture</CardTitle>
        <CardDescription>
          Use your device camera to capture card images
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isCameraActive ? (
          <div className="flex min-h-[400px] flex-col items-center justify-center gap-4">
            <div className="rounded-full bg-primary/10 p-6">
              <Camera className="h-12 w-12 text-primary" aria-hidden="true" />
            </div>
            <Button onClick={onStart} size="lg">
              <Camera className="mr-2 h-4 w-4" />
              Start Camera
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative w-full aspect-[4/3] bg-black rounded-lg overflow-hidden">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                aria-label="Camera preview"
              />
              
              <Button 
                onClick={onToggle} 
                variant="secondary" 
                size="icon"
                className="absolute top-4 right-4 z-10 rounded-full bg-black/70 hover:bg-black/80"
                aria-label="Switch camera"
              >
                <SwitchCamera className="h-5 w-5 text-white" />
              </Button>
              
              {/* Card frame overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden="true">
                <div className="relative w-[85%] h-[75%]">
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary rounded-tl-lg" />
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary rounded-tr-lg" />
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary rounded-bl-lg" />
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary rounded-br-lg" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-12 h-0.5 bg-primary/50" />
                    <div className="absolute w-0.5 h-12 bg-primary/50" />
                  </div>
                </div>
              </div>
              
              <div className="absolute top-4 left-0 right-0 flex justify-center pointer-events-none">
                <div className="bg-black/70 text-white px-4 py-2 rounded-full text-sm font-medium">
                  Align card within frame
                </div>
              </div>

              {/* Zoom Controls */}
              <ZoomControls
                zoomLevel={zoomLevel}
                minZoom={zoomCapabilities.min}
                maxZoom={zoomCapabilities.max}
                supported={zoomCapabilities.supported}
                onZoomIn={onZoomIn}
                onZoomOut={onZoomOut}
                onZoomChange={onZoomChange}
                onReset={onZoomReset}
                variant="overlay"
              />
            </div>
            
            <div className="flex gap-2">
              <Button onClick={onCapture} size="lg" className="flex-1">
                <Camera className="mr-2 h-5 w-5" />
                Capture Card
              </Button>
              <Button onClick={onStop} variant="outline" size="lg">
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Position your card within the frame guides for best results
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
