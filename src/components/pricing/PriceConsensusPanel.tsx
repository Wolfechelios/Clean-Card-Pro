// src/components/pricing/PriceConsensusPanel.tsx
// Additive UI panel showing price consensus, anomaly flags, and source breakdown

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  TrendingUp,
  Info,
} from "lucide-react";
import type { PriceConsensus, ConsensusFlag, PriceQuote } from "@/lib/pricing/types";

interface PriceConsensusPanelProps {
  consensus: PriceConsensus | null;
  loading?: boolean;
  error?: string | null;
  needsReview?: boolean;
  onUseConsensusPrice?: (price: number) => void;
  onRescan?: () => void;
  className?: string;
}

const FLAG_LABELS: Record<ConsensusFlag, { label: string; severity: "warn" | "error" }> = {
  OUTLIER_QUOTE: { label: "Outlier price detected", severity: "error" },
  NOT_ENOUGH_SOURCES: { label: "Limited sources", severity: "warn" },
  LOW_MATCH_CONFIDENCE: { label: "Low match confidence", severity: "error" },
  LOW_SAMPLE_COUNT: { label: "Few data points", severity: "warn" },
  GRADE_MISMATCH: { label: "Grade mismatch", severity: "error" },
  VARIANT_AMBIGUOUS: { label: "Variant unclear", severity: "warn" },
};

function ConfidenceIndicator({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  let color = "bg-destructive";
  let Icon = ShieldAlert;

  if (pct >= 75) {
    color = "bg-success";
    Icon = ShieldCheck;
  } else if (pct >= 55) {
    color = "bg-yellow-500";
    Icon = AlertTriangle;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5">
            <Icon className={`h-4 w-4 ${pct >= 75 ? "text-success" : pct >= 55 ? "text-yellow-500" : "text-destructive"}`} />
            <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-muted-foreground font-mono">{pct}%</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>Price confidence: {pct}%</p>
          <p className="text-xs text-muted-foreground">
            Based on source count, price agreement, and match quality
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function QuoteRow({ quote }: { quote: PriceQuote }) {
  const kindBadge = {
    sold: { label: "Sold", variant: "default" as const },
    listing: { label: "Listing", variant: "secondary" as const },
    guide: { label: "Guide", variant: "outline" as const },
  };

  const { label, variant } = kindBadge[quote.kind];

  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <div className="flex items-center gap-2">
        <Badge variant={variant} className="text-[10px] px-1.5 py-0">
          {label}
        </Badge>
        <span className="text-xs text-muted-foreground">{quote.source}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono font-medium">
          ${quote.priceUSD.toFixed(2)}
        </span>
        {quote.url && (
          <a
            href={quote.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-primary transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

export function PriceConsensusPanel({
  consensus,
  loading,
  error,
  needsReview,
  onUseConsensusPrice,
  onRescan,
  className = "",
}: PriceConsensusPanelProps) {
  const [showSources, setShowSources] = useState(false);

  if (loading) {
    return (
      <div className={`rounded-lg border border-border bg-card p-4 space-y-3 ${className}`}>
        <div className="flex items-center gap-2">
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Verifying price across sources…</span>
        </div>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-lg border border-destructive/30 bg-destructive/5 p-4 ${className}`}>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="text-sm text-destructive">{error}</span>
        </div>
      </div>
    );
  }

  if (!consensus) return null;

  const { recommendedUSD, lowUSD, highUSD, confidence, flags, quotes } = consensus;

  return (
    <div
      className={`rounded-lg border p-4 space-y-3 ${
        needsReview
          ? "border-yellow-500/50 bg-yellow-500/5"
          : "border-success/30 bg-success/5"
      } ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Price Consensus</span>
        </div>
        <ConfidenceIndicator confidence={confidence} />
      </div>

      {/* Anomaly badge */}
      {needsReview && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-yellow-500/10 border border-yellow-500/30">
          <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />
          <span className="text-xs font-medium text-yellow-600 dark:text-yellow-400">
            Price anomaly detected — verify variant / comps
          </span>
        </div>
      )}

      {/* Recommended price */}
      <div className="flex items-baseline gap-3">
        <span className="text-2xl font-bold font-mono text-primary">
          ${recommendedUSD.toFixed(2)}
        </span>
        <span className="text-xs text-muted-foreground">
          Range: ${lowUSD.toFixed(2)} – ${highUSD.toFixed(2)}
        </span>
      </div>

      {/* Flags (deduped — same flag may be emitted twice by consensus engine) */}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Array.from(new Set(flags)).map((flag, i) => {
            const meta = FLAG_LABELS[flag];
            if (!meta) return null;
            return (
              <Badge
                key={`${flag}-${i}`}
                variant={meta.severity === "error" ? "destructive" : "secondary"}
                className="text-[10px]"
              >
                {meta.label}
              </Badge>
            );
          })}
        </div>
      )}

      {/* Source breakdown toggle */}
      <div>
        <button
          onClick={() => setShowSources(!showSources)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Info className="h-3 w-3" />
          {showSources ? "Hide" : "Show"} {quotes.length} source{quotes.length !== 1 ? "s" : ""}
        </button>
        {showSources && (
          <div className="mt-2 pl-1">
            {quotes.map((q, i) => (
              <QuoteRow key={`${q.source}-${i}`} quote={q} />
            ))}
          </div>
        )}
      </div>

      {/* Actions (shown when review needed) */}
      {needsReview && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
          {onUseConsensusPrice && recommendedUSD > 0 && (
            <Button
              size="sm"
              variant="default"
              onClick={() => onUseConsensusPrice(recommendedUSD)}
              className="text-xs"
            >
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Use ${recommendedUSD.toFixed(2)}
            </Button>
          )}
          {quotes.some((q) => q.url) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const urls = quotes.filter((q) => q.url).map((q) => q.url!);
                urls.forEach((url) => window.open(url, "_blank"));
              }}
              className="text-xs"
            >
              <ExternalLink className="h-3 w-3 mr-1" />
              Open sold comps
            </Button>
          )}
          {onRescan && (
            <Button size="sm" variant="ghost" onClick={onRescan} className="text-xs">
              <RefreshCw className="h-3 w-3 mr-1" />
              Rescan / choose variant
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
