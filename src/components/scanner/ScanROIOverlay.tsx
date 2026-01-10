// src/components/scanner/ScanROIOverlay.tsx
// Visual ROI (Region of Interest) overlay showing where to place the card.
// Provides feedback on detection state.

import { cn } from "@/lib/utils";
import type { AutoScanState } from "@/lib/autoscan";

export type ScanROIOverlayProps = {
  state: AutoScanState;
  progress: number; // 0-1 for stabilization progress
  enabled: boolean;
  qualityIssue?: "sharpness" | "exposure" | "glare" | null;
};

export function ScanROIOverlay({ 
  state, 
  progress, 
  enabled,
  qualityIssue,
}: ScanROIOverlayProps) {
  if (!enabled) return null;

  const stateColors: Record<AutoScanState, string> = {
    SEARCHING: "border-white/50",
    STABILIZING: "border-yellow-400",
    CAPTURED_LOCK: "border-green-500",
    COOLDOWN: "border-blue-400",
  };

  const stateLabels: Record<AutoScanState, string> = {
    SEARCHING: "Place card in box",
    STABILIZING: "Hold steady...",
    CAPTURED_LOCK: "Captured! Remove card",
    COOLDOWN: "Ready for next",
  };

  // Quality issue messages
  const qualityMessages: Record<string, string> = {
    sharpness: "Too blurry - hold steady",
    exposure: "Too dark/bright - adjust lighting",
    glare: "Glare detected - tilt card",
  };

  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      {/* ROI Box - center guide */}
      <div 
        className={cn(
          "relative w-[70%] aspect-[2.5/3.5] border-4 rounded-lg transition-all duration-300",
          stateColors[state],
          state === "CAPTURED_LOCK" && "animate-pulse"
        )}
        style={{
          boxShadow: state === "STABILIZING" 
            ? `0 0 20px 4px rgba(250, 204, 21, ${0.3 + progress * 0.5})` 
            : state === "CAPTURED_LOCK"
            ? "0 0 30px 6px rgba(34, 197, 94, 0.6)"
            : undefined,
        }}
      >
        {/* Corner markers */}
        <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-current rounded-tl-md" />
        <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-current rounded-tr-md" />
        <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-current rounded-bl-md" />
        <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-current rounded-br-md" />

        {/* Stabilization progress bar (inside top of box) */}
        {state === "STABILIZING" && (
          <div className="absolute top-2 left-2 right-2 h-1.5 bg-black/30 rounded-full overflow-hidden">
            <div 
              className="h-full bg-yellow-400 transition-all duration-100 rounded-full"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}

        {/* Captured checkmark */}
        {state === "CAPTURED_LOCK" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-green-500 rounded-full p-3">
              <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
        )}
      </div>

      {/* Status label */}
      <div className="absolute bottom-16 left-0 right-0 flex flex-col items-center gap-1">
        <div className={cn(
          "px-4 py-2 rounded-full text-sm font-medium backdrop-blur-sm",
          state === "SEARCHING" && "bg-black/50 text-white",
          state === "STABILIZING" && "bg-yellow-500/80 text-black",
          state === "CAPTURED_LOCK" && "bg-green-500/80 text-white",
          state === "COOLDOWN" && "bg-blue-500/80 text-white",
        )}>
          {qualityIssue && state === "STABILIZING" 
            ? qualityMessages[qualityIssue] 
            : stateLabels[state]}
        </div>
        
        {state === "STABILIZING" && !qualityIssue && (
          <div className="text-xs text-white/80 bg-black/40 px-2 py-1 rounded">
            {Math.round(progress * 100)}%
          </div>
        )}
      </div>
    </div>
  );
}
