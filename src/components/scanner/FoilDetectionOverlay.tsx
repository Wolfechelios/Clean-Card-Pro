import { cn } from "@/lib/utils";
import { Sparkles } from "lucide-react";
import type { MultiFrameResult } from "@/lib/foilTrainer/multiFrameAnalyzer";

interface FoilDetectionOverlayProps {
  result: MultiFrameResult | null;
  frameCount: number;
  visible: boolean;
}

const RARITY_LABELS: Record<string, string> = {
  normal: "Normal",
  holo: "Holo",
  reverse_holo: "Reverse Holo",
  secret_rare: "Secret Rare",
};

export function FoilDetectionOverlay({ result, frameCount, visible }: FoilDetectionOverlayProps) {
  if (!visible) return null;

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
      <div className={cn(
        "flex items-center gap-2 rounded-full px-3 py-1.5 backdrop-blur-md transition-all duration-300",
        !result
          ? "bg-black/40 text-white/60"
          : result.rarity === "normal"
          ? "bg-black/50 text-white/70"
          : result.rarity === "secret_rare"
          ? "bg-amber-500/20 border border-amber-400/30 text-amber-200"
          : "bg-primary/20 border border-primary/30 text-primary-foreground"
      )}>
        {result && result.rarity !== "normal" && (
          <Sparkles className="h-3.5 w-3.5 text-amber-300 animate-pulse" />
        )}
        <span className="text-xs font-medium">
          {!result
            ? `Analyzing… (${frameCount} frame${frameCount !== 1 ? "s" : ""})`
            : result.guidance
            ? result.guidance
            : result.rarity === "normal"
            ? "Likely normal card"
            : `${RARITY_LABELS[result.rarity] || result.rarity} detected (${result.confidence}%)`
          }
        </span>
      </div>
    </div>
  );
}
