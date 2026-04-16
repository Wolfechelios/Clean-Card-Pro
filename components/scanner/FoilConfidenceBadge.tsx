// FoilConfidenceBadge — shows foil confidence level with color coding

import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";

interface FoilConfidenceBadgeProps {
  confidence: number; // 0–1
  className?: string;
}

export function FoilConfidenceBadge({ confidence, className }: FoilConfidenceBadgeProps) {
  const pct = Math.round(confidence * 100);

  const variant: "default" | "secondary" | "destructive" | "outline" =
    confidence >= 0.9 ? "default" :
    confidence >= 0.7 ? "secondary" :
    "destructive";

  const label =
    confidence >= 0.9 ? "High" :
    confidence >= 0.7 ? "Medium" :
    "Low";

  return (
    <Badge variant={variant} className={className}>
      <Sparkles className="h-3 w-3 mr-1" />
      Foil {label} ({pct}%)
    </Badge>
  );
}
