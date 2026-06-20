import { useCallback, useEffect, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Thermometer } from "lucide-react";
import {
  detectWhiteBalanceSupport,
  setWhiteBalanceMode,
  setColorTemperature,
  getVideoTrack,
  type WhiteBalanceSupport,
} from "@/lib/mediaControls";

interface WhiteBalanceControlProps {
  streamRef: React.RefObject<MediaStream | null>;
  /** Compact overlay style for inside the viewfinder */
  variant?: "panel" | "overlay";
}

export function WhiteBalanceControl({ streamRef, variant = "panel" }: WhiteBalanceControlProps) {
  const [wbSupport, setWbSupport] = useState<WhiteBalanceSupport>({
    supported: false,
    modes: [],
    temperatureRange: null,
  });
  const [mode, setMode] = useState<string>("continuous");
  const [temperature, setTemperature] = useState<number>(5500);

  // Detect capabilities when stream changes
  useEffect(() => {
    const track = getVideoTrack(streamRef.current);
    if (!track) return;
    const support = detectWhiteBalanceSupport(track);
    setWbSupport(support);
    if (support.temperatureRange) {
      // Start at midpoint
      const mid = Math.round(
        (support.temperatureRange.min + support.temperatureRange.max) / 2
      );
      setTemperature(mid);
    }
  }, [streamRef.current]);

  const handleModeChange = useCallback(
    async (newMode: string) => {
      const track = getVideoTrack(streamRef.current);
      if (!track) return;
      const ok = await setWhiteBalanceMode(track, newMode);
      if (ok) setMode(newMode);
    },
    [streamRef]
  );

  const handleTemperatureChange = useCallback(
    async (value: number) => {
      setTemperature(value);
      const track = getVideoTrack(streamRef.current);
      if (!track) return;
      await setColorTemperature(track, value);
    },
    [streamRef]
  );

  if (!wbSupport.supported) return null;

  const hasManual = wbSupport.modes.includes("manual");
  const hasContinuous = wbSupport.modes.includes("continuous");
  const hasTemp = wbSupport.temperatureRange !== null && mode === "manual";

  if (variant === "overlay") {
    return (
      <div className="absolute bottom-14 left-3 z-10 bg-black/70 rounded-lg px-3 py-2 flex items-center gap-2 max-w-[260px]">
        <Thermometer className="h-4 w-4 text-white/80 shrink-0" />
        {hasManual && hasContinuous && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-white hover:text-white hover:bg-white/20"
            onClick={() => handleModeChange(mode === "manual" ? "continuous" : "manual")}
          >
            {mode === "manual" ? "Manual" : "Auto"}
          </Button>
        )}
        {hasTemp && wbSupport.temperatureRange && (
          <>
            <Slider
              value={[temperature]}
              onValueChange={([v]) => handleTemperatureChange(v)}
              min={wbSupport.temperatureRange.min}
              max={wbSupport.temperatureRange.max}
              step={wbSupport.temperatureRange.step}
              className="w-24"
            />
            <span className="text-[10px] text-white/60 w-10 text-right">{temperature}K</span>
          </>
        )}
      </div>
    );
  }

  // Panel variant (for side controls)
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Thermometer className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">White Balance</span>
      </div>

      <div className="flex gap-2">
        {hasContinuous && (
          <Button
            variant={mode === "continuous" ? "default" : "outline"}
            size="sm"
            onClick={() => handleModeChange("continuous")}
          >
            Auto
          </Button>
        )}
        {hasManual && (
          <Button
            variant={mode === "manual" ? "default" : "outline"}
            size="sm"
            onClick={() => handleModeChange("manual")}
          >
            Manual
          </Button>
        )}
      </div>

      {hasTemp && wbSupport.temperatureRange && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-10">Cool</span>
          <Slider
            value={[temperature]}
            onValueChange={([v]) => handleTemperatureChange(v)}
            min={wbSupport.temperatureRange.min}
            max={wbSupport.temperatureRange.max}
            step={wbSupport.temperatureRange.step}
            className="flex-1"
          />
          <span className="text-xs text-muted-foreground w-10 text-right">Warm</span>
          <span className="text-xs text-muted-foreground w-12 text-right">{temperature}K</span>
        </div>
      )}
    </div>
  );
}
