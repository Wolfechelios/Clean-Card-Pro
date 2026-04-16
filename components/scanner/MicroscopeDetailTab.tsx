import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Camera, Loader2, AlertCircle, RefreshCw, Microscope, Focus } from "lucide-react";
import { toast } from "sonner";
import { useMicroscopeCamera, RESOLUTION_PRESETS, ResolutionPreset } from "@/hooks/use-microscope-camera";
import { MicroscopeCapture, MicroscopeCaptureType } from "@/lib/microscope/types";
import { MicroscopeSharpnessIndicator } from "./MicroscopeSharpnessIndicator";
import { MicroscopeReviewPanel } from "./MicroscopeReviewPanel";
import { useScannerSettings } from "@/hooks/use-scanner-settings";

interface MicroscopeDetailTabProps {
  parentScanId?: string | null;
  parentImageUrl?: string | null;
  onCaptureComplete?: (capture: MicroscopeCapture) => void;
  onImageCaptured?: (imageFile: File) => void;
}

const CAPTURE_TYPES: { value: MicroscopeCaptureType; label: string; desc: string }[] = [
  { value: "full_card_scan", label: "Full Card Scan", desc: "Use microscope as primary scanner for card identification" },
  { value: "foil_detail", label: "Foil / Holo Detail", desc: "Capture reflective patterns, holo shimmer, foil texture" },
  { value: "surface_detail", label: "Surface / Print", desc: "Capture surface texture, print quality, ink patterns" },
  { value: "corner_detail", label: "Corner / Edge", desc: "Capture corner wear, edge whitening, centering" },
  { value: "text_detail", label: "Text / Number", desc: "Capture card number, set symbol, fine text" },
];

export function MicroscopeDetailTab({ parentScanId, parentImageUrl, onCaptureComplete, onImageCaptured }: MicroscopeDetailTabProps) {
  const [captureType, setCaptureType] = useState<MicroscopeCaptureType>("full_card_scan");
  const [captures, setCaptures] = useState<MicroscopeCapture[]>([]);
  const [reviewCapture, setReviewCapture] = useState<MicroscopeCapture | null>(null);
  const { updateSettings } = useScannerSettings();

  const {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    cameraReady,
    isInitializing,
    cameraError,
    sharpness,
    resolution,
    requestedResolution,
    actualResolution,
    deviceCapabilities,
    fellBack,
    resolutionPreset,
    videoRef,
    startCamera,
    stopCamera,
    capturePhoto,
    refreshDevices,
    changeResolution,
  } = useMicroscopeCamera();

  const microscopeDevices = devices.filter(d => d.isMicroscope);
  const otherDevices = devices.filter(d => !d.isMicroscope);

  const handleDeviceChange = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
    // Save preferred microscope device
    updateSettings({ preferredMicroscopeDeviceId: deviceId } as any);
    if (cameraReady || cameraError) {
      startCamera(deviceId);
    }
  }, [setSelectedDeviceId, updateSettings, cameraReady, cameraError, startCamera]);

  const handleCapture = useCallback(async () => {
    const file = await capturePhoto();
    if (!file) return;

    const imageUrl = URL.createObjectURL(file);
    const capture: MicroscopeCapture = {
      id: crypto.randomUUID(),
      source: "microscope",
      captureType,
      parentScanId: parentScanId || null,
      deviceLabel: devices.find(d => d.deviceId === selectedDeviceId)?.label || "Unknown",
      imageUrl,
      imageFile: file,
      sharpness,
      resolution,
      capturedAt: new Date().toISOString(),
    };

    setCaptures(prev => [capture, ...prev]);
    setReviewCapture(capture);
    onCaptureComplete?.(capture);

    // Full card scan mode: route through normal card identification pipeline
    if (captureType === "full_card_scan" && onImageCaptured) {
      onImageCaptured(file);
      toast.success("Card captured via microscope — running identification...");
    } else {
      toast.success(`${CAPTURE_TYPES.find(t => t.value === captureType)?.label} captured`);
    }
  }, [capturePhoto, captureType, parentScanId, devices, selectedDeviceId, sharpness, resolution, onCaptureComplete, onImageCaptured]);

  // Keyboard capture
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (cameraReady && (e.code === "Space" || e.code === "Enter")) {
        e.preventDefault();
        handleCapture();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [cameraReady, handleCapture]);

  return (
    <div className="space-y-4">
      <Card className="shadow-card">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Microscope className="h-5 w-5 text-primary" />
                Microscope Detail
              </CardTitle>
              <CardDescription>
                Use a USB microscope for foil verification, surface inspection, and detail captures
              </CardDescription>
            </div>
            {microscopeDevices.length > 0 && (
              <Badge variant="secondary" className="bg-primary/10 text-primary">
                <Microscope className="mr-1 h-3 w-3" />
                {microscopeDevices.length} microscope{microscopeDevices.length > 1 ? "s" : ""} found
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Device selector */}
          <div className="flex items-center gap-2">
            <Select value={selectedDeviceId} onValueChange={handleDeviceChange}>
              <SelectTrigger className="flex-1 bg-background/80 backdrop-blur-sm">
                <SelectValue placeholder="Select microscope or camera" />
              </SelectTrigger>
              <SelectContent>
                {microscopeDevices.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Microscopes</div>
                    {microscopeDevices.map(d => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        <div className="flex items-center gap-2">
                          <Microscope className="h-4 w-4 text-primary" />
                          <span className="truncate max-w-[200px]">{d.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </>
                )}
                {otherDevices.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-xs text-muted-foreground font-medium">Other Cameras</div>
                    {otherDevices.map(d => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>
                        <div className="flex items-center gap-2">
                          <Camera className="h-4 w-4 text-muted-foreground" />
                          <span className="truncate max-w-[200px]">{d.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" onClick={refreshDevices} className="shrink-0">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {/* Resolution selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Resolution:</span>
            <Select value={resolutionPreset} onValueChange={(v) => changeResolution(v as ResolutionPreset)}>
              <SelectTrigger className="w-[160px] h-8 text-xs bg-background/80 backdrop-blur-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOLUTION_PRESETS.map(p => (
                  <SelectItem key={p.value} value={p.value}>
                    <span className="text-xs">{p.label} ({p.width}×{p.height})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Capture type selector */}
          <div className="grid grid-cols-2 gap-2">
            {CAPTURE_TYPES.map(ct => (
              <Button
                key={ct.value}
                variant={captureType === ct.value ? "default" : "outline"}
                size="sm"
                onClick={() => setCaptureType(ct.value)}
                className="text-xs h-auto py-2 px-3 flex flex-col items-start"
              >
                <span className="font-medium">{ct.label}</span>
                <span className="text-[10px] opacity-70 font-normal">{ct.desc}</span>
              </Button>
            ))}
          </div>

          {/* Camera preview */}
          <div className="relative bg-black rounded-lg overflow-hidden mx-auto w-full">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-auto block"
              style={{ maxHeight: "70vh" }}
            />

            {!cameraReady && !isInitializing && !cameraError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                <div className="text-center text-white p-4">
                  <Microscope className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="mb-2 text-sm">Connect a USB microscope and click Start</p>
                  <Button onClick={() => startCamera()} disabled={!selectedDeviceId} variant="secondary" size="sm">
                    <Focus className="mr-2 h-4 w-4" />
                    Start Microscope
                  </Button>
                </div>
              </div>
            )}

            {isInitializing && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="text-center text-white">
                  <Loader2 className="h-10 w-10 animate-spin mx-auto mb-2" />
                  <p className="text-sm">Connecting...</p>
                </div>
              </div>
            )}

            {cameraError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4">
                <div className="text-center text-white">
                  <AlertCircle className="h-10 w-10 mx-auto mb-3 text-destructive" />
                  <p className="text-sm mb-3">{cameraError}</p>
                  <Button onClick={() => startCamera()} variant="secondary" size="sm">Retry</Button>
                </div>
              </div>
            )}

            {/* Crosshair overlay */}
            {cameraReady && (
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/2 left-0 right-0 h-px bg-primary/30" />
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-primary/30" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 border border-primary/40 rounded-full" />
              </div>
            )}

            {/* Sharpness indicator */}
            {cameraReady && <MicroscopeSharpnessIndicator sharpness={sharpness} />}

            {/* Resolution badge */}
            {cameraReady && actualResolution.width > 0 && (
              <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                <Badge variant="secondary" className="bg-black/60 text-white text-[10px]">
                  {actualResolution.width}×{actualResolution.height}
                  {fellBack && " (negotiated)"}
                </Badge>
                {fellBack && requestedResolution.width > 0 && (
                  <Badge variant="outline" className="bg-black/40 text-yellow-300 text-[9px] border-yellow-400/40">
                    Requested {requestedResolution.width}×{requestedResolution.height}
                  </Badge>
                )}
                {deviceCapabilities && (
                  <Badge variant="outline" className="bg-black/40 text-white/70 text-[9px] border-white/20">
                    Max {deviceCapabilities.maxWidth}×{deviceCapabilities.maxHeight}
                  </Badge>
                )}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            {cameraReady ? (
              <>
                <Button onClick={handleCapture} size="lg" className="flex-1">
                  <Camera className="mr-2 h-5 w-5" />
                  Capture {CAPTURE_TYPES.find(t => t.value === captureType)?.label}
                </Button>
                <Button onClick={stopCamera} variant="outline" size="lg">Stop</Button>
              </>
            ) : (
              <Button
                onClick={() => startCamera()}
                size="lg"
                className="w-full"
                disabled={!selectedDeviceId || isInitializing}
              >
                {isInitializing ? (
                  <><Loader2 className="mr-2 h-5 w-5 animate-spin" />Connecting...</>
                ) : (
                  <><Microscope className="mr-2 h-5 w-5" />Start Microscope</>
                )}
              </Button>
            )}
          </div>

          {/* Capture thumbnails */}
          {captures.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Recent Captures ({captures.length})</h4>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {captures.slice(0, 8).map(c => (
                  <button
                    key={c.id}
                    onClick={() => setReviewCapture(c)}
                    className="shrink-0 rounded-md overflow-hidden border-2 transition-colors hover:border-primary"
                    style={{ width: 72, height: 72, borderColor: reviewCapture?.id === c.id ? "hsl(var(--primary))" : "transparent" }}
                  >
                    <img src={c.imageUrl} alt={c.captureType} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Side-by-side review */}
      {reviewCapture && (
        <MicroscopeReviewPanel
          capture={reviewCapture}
          parentImageUrl={parentImageUrl || null}
          onClose={() => setReviewCapture(null)}
        />
      )}
    </div>
  );
}
