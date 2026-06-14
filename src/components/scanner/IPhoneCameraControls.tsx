import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { Crosshair, Flashlight, FlashlightOff, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";

type IPhoneCameraControlsProps = {
  cameraOn: boolean;
  torchSupported: boolean;
  torchOn: boolean;
  focusSupported: boolean;
  zoomSupported: boolean;
  zoomLevel: number;
  minZoom: number;
  maxZoom: number;
  usingDigitalZoom?: boolean;
  onToggleTorch: () => void | Promise<void>;
  onFocusCenter?: () => void | Promise<void>;
  onZoomChange: (zoom: number) => void | Promise<void>;
  onZoomIn: () => void | Promise<void>;
  onZoomOut: () => void | Promise<void>;
  onResetZoom: () => void | Promise<void>;
  className?: string;
};

function clampPreset(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function IPhoneCameraControls({
  cameraOn,
  torchSupported,
  torchOn,
  focusSupported,
  zoomSupported,
  zoomLevel,
  minZoom,
  maxZoom,
  usingDigitalZoom = false,
  onToggleTorch,
  onFocusCenter,
  onZoomChange,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  className,
}: IPhoneCameraControlsProps) {
  if (!cameraOn) return null;

  const safeMin = Number.isFinite(minZoom) ? minZoom : 1;
  const safeMax = Number.isFinite(maxZoom) && maxZoom > safeMin ? maxZoom : Math.max(3, safeMin);
  const safeZoom = clampPreset(zoomLevel || safeMin, safeMin, safeMax);
  const presets = [1, 1.5, 2, 3].filter((z) => z >= safeMin && z <= safeMax);

  return (
    <div className={cn("rounded-2xl border bg-card/95 p-3 shadow-sm backdrop-blur", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold leading-none">iPhone Camera Controls</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Zoom, flash, and focus controls for iPhone, Continuity Camera, USB, and supported virtual camera feeds.
          </div>
        </div>
        <Badge variant="outline" className="shrink-0 text-xs">
          {usingDigitalZoom ? "Digital" : "Optical/API"}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button
          type="button"
          variant={torchOn ? "secondary" : "outline"}
          className="h-12 rounded-xl"
          disabled={!torchSupported}
          onClick={() => void onToggleTorch()}
          title={torchSupported ? "Toggle iPhone flash/torch" : "Torch not exposed by this browser/camera"}
        >
          {torchOn ? <FlashlightOff className="mr-2 h-4 w-4" /> : <Flashlight className="mr-2 h-4 w-4" />}
          Flash
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-12 rounded-xl"
          disabled={!focusSupported || !onFocusCenter}
          onClick={() => void onFocusCenter?.()}
          title={focusSupported ? "Focus center" : "Manual focus point not exposed by this browser/camera"}
        >
          <Crosshair className="mr-2 h-4 w-4" />
          Focus
        </Button>

        <Button
          type="button"
          variant="outline"
          className="h-12 rounded-xl"
          disabled={!zoomSupported || safeZoom <= safeMin}
          onClick={() => void onResetZoom()}
          title="Reset zoom"
        >
          <RotateCcw className="mr-2 h-4 w-4" />
          Reset
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Zoom</span>
          <span className="font-semibold text-foreground">{safeZoom.toFixed(1)}×</span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 w-11 rounded-xl"
            disabled={!zoomSupported || safeZoom <= safeMin}
            onClick={() => void onZoomOut()}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>

          <Slider
            value={[safeZoom]}
            min={safeMin}
            max={safeMax}
            step={0.1}
            disabled={!zoomSupported}
            onValueChange={(values) => void onZoomChange(values[0])}
            className="min-w-0 flex-1"
            aria-label="iPhone camera zoom"
          />

          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-11 w-11 rounded-xl"
            disabled={!zoomSupported || safeZoom >= safeMax}
            onClick={() => void onZoomIn()}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>

        {presets.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Button
                key={preset}
                type="button"
                variant={Math.abs(safeZoom - preset) < 0.05 ? "secondary" : "outline"}
                size="sm"
                className="h-8 rounded-full px-3 text-xs"
                disabled={!zoomSupported}
                onClick={() => void onZoomChange(clampPreset(preset, safeMin, safeMax))}
              >
                {preset.toFixed(preset % 1 === 0 ? 0 : 1)}×
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 text-[11px] leading-snug text-muted-foreground">
        Unsupported controls are disabled because Chrome/Safari only expose what the active iPhone camera feed allows.
      </div>
    </div>
  );
}

export default IPhoneCameraControls;
