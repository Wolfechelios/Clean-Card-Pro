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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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

  const safeMin = Number.isFinite(minZoom) ? minZoom : 1;
  const safeMax = Number.isFinite(maxZoom) && maxZoom > safeMin ? maxZoom : Math.max(4, safeMin);
  const safeZoom = clamp(zoomLevel || safeMin, safeMin, safeMax);
  const presets = [1, 1.5, 2, 3].filter((z) => z >= safeMin && z <= safeMax);

  if (variant === "overlay") {
    return (
      <div className="absolute bottom-3 left-3 right-3 z-10 pointer-events-none">
        <div className="pointer-events-auto rounded-2xl bg-black/70 p-3 text-white shadow-lg backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold">iPhone Zoom</span>
            <button
              type="button"
              onClick={onReset}
              disabled={safeZoom <= safeMin}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[11px] font-medium disabled:opacity-40"
              aria-label="Reset zoom"
            >
              <RotateCcw className="h-3 w-3" />
              {safeZoom.toFixed(1)}×
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="icon"
              className="h-11 w-11 rounded-full bg-white/15 hover:bg-white/25 border-0"
              onClick={onZoomOut}
              disabled={safeZoom <= safeMin}
              aria-label="Zoom out"
            >
              <ZoomOut className="h-5 w-5 text-white" />
            </Button>

            <Slider
              value={[safeZoom]}
              min={safeMin}
              max={safeMax}
              step={0.1}
              onValueChange={(values) => onZoomChange(values[0])}
              className="min-w-0 flex-1"
              aria-label="Zoom level"
            />

            <Button
              variant="secondary"
              size="icon"
              className="h-11 w-11 rounded-full bg-white/15 hover:bg-white/25 border-0"
              onClick={onZoomIn}
              disabled={safeZoom >= safeMax}
              aria-label="Zoom in"
            >
              <ZoomIn className="h-5 w-5 text-white" />
            </Button>
          </div>

          {presets.length > 0 && (
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onZoomChange(clamp(preset, safeMin, safeMax))}
                  className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold hover:bg-white/20"
                >
                  {preset.toFixed(preset % 1 === 0 ? 0 : 1)}×
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9"
        onClick={onZoomOut}
        disabled={safeZoom <= safeMin}
        aria-label="Zoom out"
      >
        <ZoomOut className="h-4 w-4" />
      </Button>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Slider
          value={[safeZoom]}
          min={safeMin}
          max={safeMax}
          step={0.1}
          onValueChange={(values) => onZoomChange(values[0])}
          className="flex-1"
          aria-label="Zoom level"
        />
        <span className="min-w-[2.8rem] text-center text-sm font-medium">
          {safeZoom.toFixed(1)}×
        </span>
      </div>

      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9"
        onClick={onZoomIn}
        disabled={safeZoom >= safeMax}
        aria-label="Zoom in"
      >
        <ZoomIn className="h-4 w-4" />
      </Button>

      {safeZoom > safeMin && (
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9"
          onClick={onReset}
          aria-label="Reset zoom"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
