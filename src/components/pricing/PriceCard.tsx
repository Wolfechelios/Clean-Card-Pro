import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, TrendingUp, Users, AlertCircle, CheckCircle, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface NormalizedComp {
  provider: string;
  grader: string;
  grade: string;
  sale_price_USD: number;
  sale_date: string;
  seller_name: string;
}

interface PopulationData {
  PSA: Record<string, number>;
  BGS: Record<string, number>;
  CGC: Record<string, number>;
}

interface PricingData {
  canonical_card: {
    set?: string;
    year?: string;
    player?: string;
    name?: string;
    card_number?: string;
    variant?: string;
  };
  aggregated: {
    price_USD: number;
    price_type: string;
    confidence_score: number;
  };
  comps: NormalizedComp[];
  populations: PopulationData;
  providers: { name: string; status: string; error?: string }[];
  notes: string[];
  last_updated: string;
}

interface PriceCardProps {
  data: PricingData | null;
  loading?: boolean;
  grader?: string;
  grade?: string;
}

export function PriceCard({ data, loading, grader, grade }: PriceCardProps) {
  const [showComps, setShowComps] = useState(false);
  const [showProviders, setShowProviders] = useState(false);

  if (loading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-12 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-24" />
          </div>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="bg-card border-border">
        <CardContent className="py-8 text-center text-muted-foreground">
          <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No pricing data available</p>
        </CardContent>
      </Card>
    );
  }

  const { canonical_card, aggregated, comps, populations, providers, notes, last_updated } = data;
  const topComps = comps.slice(0, 5);
  const confidenceColor = aggregated.confidence_score >= 0.7 
    ? "text-success" 
    : aggregated.confidence_score >= 0.4 
      ? "text-warning" 
      : "text-destructive";

  const cardTitle = [
    canonical_card.year,
    canonical_card.set,
    canonical_card.player || canonical_card.name,
    canonical_card.card_number && `#${canonical_card.card_number}`,
    canonical_card.variant,
  ].filter(Boolean).join(" ");

  const displayGrader = grader || "PSA";
  const displayGrade = grade || "10";
  const pop = populations[displayGrader as keyof PopulationData]?.[displayGrade] || 0;

  return (
    <Card className="bg-card border-border overflow-hidden">
      <CardHeader className="pb-2 bg-muted/30">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg font-semibold text-foreground">
              {cardTitle || "Card Details"}
            </CardTitle>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-xs">
                {displayGrader} {displayGrade}
              </Badge>
              {canonical_card.variant && (
                <Badge variant="secondary" className="text-xs">
                  {canonical_card.variant}
                </Badge>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-foreground">
              ${aggregated.price_USD.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">{aggregated.price_type}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {/* Confidence & Population Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <TrendingUp className={`h-4 w-4 ${confidenceColor}`} />
              <span className={`text-sm font-medium ${confidenceColor}`}>
                {Math.round(aggregated.confidence_score * 100)}% confidence
              </span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground">
              <Users className="h-4 w-4" />
              <span className="text-sm">Pop: {pop.toLocaleString()}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {new Date(last_updated).toLocaleDateString()}
          </div>
        </div>

        {/* Notes */}
        {notes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {notes.map((note, i) => (
              <Badge key={i} variant="outline" className="text-xs text-muted-foreground">
                {note}
              </Badge>
            ))}
          </div>
        )}

        {/* Population Breakdown */}
        <div className="grid grid-cols-3 gap-2 p-3 bg-muted/30 rounded-lg">
          {(["PSA", "BGS", "CGC"] as const).map((g) => (
            <div key={g} className="text-center">
              <p className="text-xs text-muted-foreground">{g}</p>
              <p className="text-sm font-semibold text-foreground">
                {populations[g]?.[displayGrade]?.toLocaleString() || "-"}
              </p>
            </div>
          ))}
        </div>

        {/* Top Comps Collapsible */}
        <Collapsible open={showComps} onOpenChange={setShowComps}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between px-0 hover:bg-transparent">
              <span className="text-sm font-medium">Recent Sales ({comps.length})</span>
              {showComps ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2">
            {topComps.map((comp, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-2 bg-muted/20 rounded text-sm"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {comp.provider}
                  </Badge>
                  <span className="text-muted-foreground">
                    {comp.grader} {comp.grade}
                  </span>
                </div>
                <div className="text-right">
                  <p className="font-medium text-foreground">${comp.sale_price_USD.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(comp.sale_date).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
            {comps.length > 5 && (
              <p className="text-xs text-muted-foreground text-center pt-2">
                +{comps.length - 5} more sales
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>

        {/* Providers Collapsible */}
        <Collapsible open={showProviders} onOpenChange={setShowProviders}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between px-0 hover:bg-transparent">
              <span className="text-sm font-medium">Data Sources</span>
              {showProviders ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid grid-cols-2 gap-2">
              {providers.map((p, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 bg-muted/20 rounded text-sm"
                >
                  {p.status === "success" ? (
                    <CheckCircle className="h-3 w-3 text-success" />
                  ) : (
                    <AlertCircle className="h-3 w-3 text-destructive" />
                  )}
                  <span className={p.status === "success" ? "text-foreground" : "text-muted-foreground"}>
                    {p.name}
                  </span>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}