import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

interface ZoomControlsProps {
  zoomLevel: number;
  minZoom: number;
  maxZoom: number;
  supported: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomChange: (level: number) => void;
  onReset: () => void;
  variant?: "overlay" | "inline";
}

export function ZoomControls({
  zoomLevel,
  minZoom,
  maxZoom,
  supported,
  onZoomIn,
  onZoomOut,
  onZoomChange,
  onReset,
  variant = "overlay",
}: ZoomControlsProps) {
  if (!supported) return null;

  if (variant === "overlay") {
    return (
      <div className="absolute bottom-4 left-4 right-4 z-10 pointer-events-none">
        <div className="flex items-center justify-center gap-2 pointer-events-auto">
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8 rounded-full bg-black/70 hover:bg-black/80 border-0"
            onClick={onZoomOut}
            disabled={zoomLevel <= minZoom}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4 text-white" />
          </Button>

          <div className="flex items-center gap-2 bg-black/70 rounded-full px-3 py-1">
            <Slider
              value={[zoomLevel]}
              min={minZoom}
              max={maxZoom}
              step={0.1}
              onValueChange={(values) => onZoomChange(values[0])}
              className="w-24"
              aria-label="Zoom level"
            />
            <span className="text-xs text-white font-medium min-w-[2.5rem] text-center">
              {zoomLevel.toFixed(1)}x
            </span>
          </div>

          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8 rounded-full bg-black/70 hover:bg-black/80 border-0"
            onClick={onZoomIn}
            disabled={zoomLevel >= maxZoom}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4 text-white" />
          </Button>
        </div>

        {zoomLevel !== 1 && (
          <div className="absolute top-4 right-4 z-10">
            <Button
              variant="secondary"
              size="icon"
              className="h-8 w-8 rounded-full bg-black/70 hover:bg-black/80 border-0"
              onClick={onReset}
              aria-label="Reset zoom"
            >
              <RotateCcw className="h-4 w-4 text-white" />
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Inline variant for use outside the video container
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={onZoomOut}
        disabled={zoomLevel <= minZoom}
        aria-label="Zoom out"
      >
        <ZoomOut className="h-4 w-4" />
      </Button>

      <div className="flex items-center gap-2 flex-1">
        <Slider
          value={[zoomLevel]}
          min={minZoom}
          max={maxZoom}
          step={0.1}
          onValueChange={(values) => onZoomChange(values[0])}
          className="flex-1"
          aria-label="Zoom level"
        />
        <span className="text-sm font-medium min-w-[2.5rem] text-center">
          {zoomLevel.toFixed(1)}x
        </span>
      </div>

      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={onZoomIn}
        disabled={zoomLevel >= maxZoom}
        aria-label="Zoom in"
      >
        <ZoomIn className="h-4 w-4" />
      </Button>

      {zoomLevel !== 1 && (
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={onReset}
          aria-label="Reset zoom"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
