import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RefreshCw, Smartphone, Monitor, Camera } from "lucide-react";
import { CameraDevice } from "@/hooks/use-camera-devices";

interface CameraDeviceSelectorProps {
  devices: CameraDevice[];
  selectedDeviceId: string;
  onDeviceChange: (deviceId: string) => void;
  onRefresh: () => void;
  isLoading?: boolean;
  className?: string;
}

export const CameraDeviceSelector = ({
  devices,
  selectedDeviceId,
  onDeviceChange,
  onRefresh,
  isLoading,
  className = "",
}: CameraDeviceSelectorProps) => {
  if (devices.length <= 1) return null;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Select value={selectedDeviceId} onValueChange={onDeviceChange}>
        <SelectTrigger className="w-[200px] bg-background/80 backdrop-blur-sm">
          <SelectValue placeholder="Select camera" />
        </SelectTrigger>
        <SelectContent>
          {devices.map((device) => (
            <SelectItem key={device.deviceId} value={device.deviceId}>
              <div className="flex items-center gap-2">
                {device.isUSB ? (
                  <Smartphone className="h-4 w-4 text-primary" />
                ) : device.label.toLowerCase().includes("front") ? (
                  <Monitor className="h-4 w-4" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
                <span className="truncate max-w-[150px]">{device.label}</span>
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
      >
        <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
};
