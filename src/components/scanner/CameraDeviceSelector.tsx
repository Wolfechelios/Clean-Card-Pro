import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RefreshCw, Smartphone, Camera, Scan, ZoomIn, Focus, Layers, Webcam, Monitor } from "lucide-react";
import { CameraDevice, LensType } from "@/hooks/use-camera-devices";

interface CameraDeviceSelectorProps {
  devices: CameraDevice[];
  selectedDeviceId: string;
  onDeviceChange: (deviceId: string) => void;
  onRefresh: () => void;
  isLoading?: boolean;
  className?: string;
}

function getLensIcon(lensType: LensType) {
  switch (lensType) {
    case "ultrawide":
      return <Scan className="h-4 w-4 text-primary" />;
    case "wide":
      return <Camera className="h-4 w-4 text-primary" />;
    case "telephoto":
      return <ZoomIn className="h-4 w-4 text-accent-foreground" />;
    case "macro":
    case "depth":
      return <Focus className="h-4 w-4 text-primary" />;
    case "camo":
    case "continuity":
    case "epoccam":
    case "droidcam":
    case "iriun":
      return <Smartphone className="h-4 w-4 text-accent-foreground" />;
    case "usb":
      return <Webcam className="h-4 w-4 text-primary" />;
    default:
      return <Layers className="h-4 w-4 text-muted-foreground" />;
  }
}

export const CameraDeviceSelector = ({
  devices,
  selectedDeviceId,
  onDeviceChange,
  onRefresh,
  isLoading,
  className = "",
}: CameraDeviceSelectorProps) => {
  if (devices.length === 0) return null;

  const hasPhoneCam = devices.some(d =>
    ["camo", "continuity", "epoccam", "droidcam", "iriun"].includes(d.lensType)
  );

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center gap-2">
        <Select value={selectedDeviceId} onValueChange={onDeviceChange}>
          <SelectTrigger className="w-[220px] bg-background/80 backdrop-blur-sm">
            <SelectValue placeholder="Select lens" />
          </SelectTrigger>
          <SelectContent>
            {devices.map((device) => (
              <SelectItem key={device.deviceId} value={device.deviceId}>
                <div className="flex items-center gap-2">
                  {getLensIcon(device.lensType)}
                  <span className="truncate max-w-[160px]">{device.lensLabel}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRefresh}
          disabled={isLoading}
          className="shrink-0"
          title="Refresh camera list"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {!hasPhoneCam && (
        <span className="text-[11px] text-muted-foreground pl-1">
          Using Camo Studio? Start it, then tap refresh.
        </span>
      )}
    </div>
  );
};
