// src/components/scanner/AutoScanIndicator.tsx
// Visual indicator for autoscan state, progress, and quality issues.

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, CheckCircle2, Loader2, Search, Lock, Timer } from "lucide-react";
import type { AutoScanStatus } from "@/hooks/use-autoscan";

type Props = {
  status: AutoScanStatus;
  className?: string;
};

export function AutoScanIndicator({ status, className }: Props) {
  if (!status.enabled) {
    return null;
  }

  const stateConfig = {
    SEARCHING: {
      icon: Search,
      label: "Looking for card...",
      color: "text-muted-foreground",
      bgColor: "bg-muted",
    },
    STABILIZING: {
      icon: Loader2,
      label: "Hold steady...",
      color: "text-yellow-500",
      bgColor: "bg-yellow-500/10",
    },
    CAPTURED_LOCK: {
      icon: Lock,
      label: "Captured! Move to next card",
      color: "text-green-500",
      bgColor: "bg-green-500/10",
    },
    COOLDOWN: {
      icon: Timer,
      label: "Ready for next card",
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
    },
  };

  const config = stateConfig[status.state];
  const Icon = config.icon;
  const isStabilizing = status.state === "STABILIZING";

  return (
    <div className={cn("rounded-lg p-2 space-y-2", config.bgColor, className)}>
      <div className="flex items-center gap-2">
        <Icon 
          className={cn(
            "h-4 w-4",
            config.color,
            isStabilizing && "animate-spin"
          )} 
        />
        <span className={cn("text-sm font-medium", config.color)}>
          {config.label}
        </span>
        
        {status.queueFull && (
          <Badge variant="destructive" className="ml-auto text-xs">
            Queue Full
          </Badge>
        )}
      </div>

      {/* Stability progress bar */}
      {isStabilizing && (
        <Progress 
          value={status.progress * 100} 
          className="h-1.5"
        />
      )}

      {/* Quality warning */}
      {status.qualityIssue && isStabilizing && (
        <div className="flex items-center gap-1.5 text-xs text-yellow-600">
          <AlertCircle className="h-3 w-3" />
          <span>
            {status.qualityIssue === "sharpness" && "Hold steady – image is blurry"}
            {status.qualityIssue === "exposure" && "Adjust lighting – too dark or bright"}
            {status.qualityIssue === "glare" && "Reduce glare – adjust angle"}
          </span>
        </div>
      )}

      {/* Success indicator */}
      {status.state === "CAPTURED_LOCK" && (
        <div className="flex items-center gap-1.5 text-xs text-green-600">
          <CheckCircle2 className="h-3 w-3" />
          <span>Photo captured automatically</span>
        </div>
      )}
    </div>
  );
}
