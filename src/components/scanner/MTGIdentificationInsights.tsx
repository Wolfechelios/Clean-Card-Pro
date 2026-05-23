import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { analyzeMtgIdentification, type MtgCardLike } from "@/lib/mtg/alphaBetaDetector";
import { Sparkles, AlertTriangle, ShieldCheck } from "lucide-react";

interface Props {
  card: MtgCardLike;
  ocrText?: string | null;
}

export function MTGIdentificationInsights({ card, ocrText }: Props) {
  const insights = useMemo(() => analyzeMtgIdentification(card, ocrText), [card, ocrText]);

  if (!insights.isMtg) return null;

  const alphaBetaLabel =
    insights.alphaBeta.status === "confirmed_alpha"
      ? "Alpha"
      : insights.alphaBeta.status === "confirmed_beta"
      ? "Beta"
      : insights.alphaBeta.status === "candidate_alpha_beta"
      ? "Alpha/Beta Candidate"
      : "Not Alpha/Beta";

  const Icon =
    insights.alphaBeta.status === "confirmed_alpha" || insights.alphaBeta.status === "confirmed_beta"
      ? ShieldCheck
      : insights.alphaBeta.status === "candidate_alpha_beta"
      ? Sparkles
      : AlertTriangle;

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" />
          MTG Print Forensics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge>{alphaBetaLabel}</Badge>
          <Badge variant="secondary">{insights.likelyEra}</Badge>
          <Badge variant="outline">{Math.round(insights.alphaBeta.confidence)}% signal</Badge>
        </div>

        <p className="text-muted-foreground">{insights.summary}</p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {insights.signals.map((signal) => (
            <div key={`${signal.label}-${signal.value}`} className="rounded-md border bg-background/70 p-2">
              <div className="text-xs text-muted-foreground">{signal.label}</div>
              <div className="font-medium">{signal.value}</div>
            </div>
          ))}
        </div>

        {insights.alphaBeta.reasons.length > 0 && (
          <div className="space-y-1">
            <div className="font-medium">Why it thinks that</div>
            <ul className="list-disc pl-5 text-muted-foreground space-y-1">
              {insights.alphaBeta.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        )}

        {insights.alphaBeta.checks.length > 0 && (
          <div className="space-y-1">
            <div className="font-medium">Best next checks</div>
            <ul className="list-disc pl-5 text-muted-foreground space-y-1">
              {insights.alphaBeta.checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
