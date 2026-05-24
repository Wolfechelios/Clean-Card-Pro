import { Minus, Plus, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useDisplayScale } from "@/hooks/use-display-scale";
import { cn } from "@/lib/utils";

interface DisplayScaleControlProps {
  variant?: "compact" | "full";
  className?: string;
}

/**
 * Global zoom / display scale control.
 * - "compact": small inline -/% /+ for navbars
 * - "full":    large slider w/ numbered presets for dashboards
 */
export function DisplayScaleControl({ variant = "compact", className }: DisplayScaleControlProps) {
  const { scale, setScale, scaleOptions } = useDisplayScale();
  const idx = scaleOptions.indexOf(scale as any);
  const min = scaleOptions[0];
  const max = scaleOptions[scaleOptions.length - 1];

  const dec = () => idx > 0 && setScale(scaleOptions[idx - 1]);
  const inc = () => idx >= 0 && idx < scaleOptions.length - 1 && setScale(scaleOptions[idx + 1]);

  if (variant === "compact") {
    return (
      <div
        className={cn(
          "flex items-center gap-0.5 rounded-lg border border-border/60 bg-secondary/40 px-1 py-0.5",
          className,
        )}
        aria-label="Display scale"
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={dec}
          disabled={scale <= min}
          aria-label="Zoom out"
        >
          <Minus className="h-3 w-3" />
        </Button>
        <span className="text-[10px] font-medium tabular-nums text-foreground min-w-[2.25rem] text-center">
          {scale}%
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={inc}
          disabled={scale >= max}
          aria-label="Zoom in"
        >
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-card/60 glass p-3 sm:p-4 shadow-sm",
        className,
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <Monitor className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Display Scale</span>
        <span className="ml-auto text-sm font-bold tabular-nums text-primary">{scale}%</span>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={dec}
          disabled={scale <= min}
          aria-label="Zoom out"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Slider
          value={[idx >= 0 ? idx : scaleOptions.indexOf(100 as any)]}
          min={0}
          max={scaleOptions.length - 1}
          step={1}
          onValueChange={(v) => setScale(scaleOptions[v[0]])}
          className="flex-1"
          aria-label="Display scale slider"
        />
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={inc}
          disabled={scale >= max}
          aria-label="Zoom in"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-10 gap-1">
        {scaleOptions.map((opt) => (
          <button
            key={opt}
            onClick={() => setScale(opt)}
            className={cn(
              "h-7 rounded-md text-[10px] font-medium tabular-nums transition-fast border",
              scale === opt
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-secondary/40 text-muted-foreground border-border/40 hover:bg-secondary hover:text-foreground",
            )}
            aria-label={`Set display scale to ${opt}%`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
