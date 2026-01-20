import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Brain,
  Sparkles,
  Shield,
  Target,
  Zap,
  Clock,
  BarChart3,
  Lightbulb,
  Wallet,
  PieChart,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CollectionCard {
  id: string;
  card_name: string;
  card_set?: string | null;
  rarity?: string | null;
  game_type?: string | null;
  sport_type?: string | null;
  suggested_price?: number | null;
}

interface CollectionPredictionData {
  prediction: {
    direction: "up" | "down" | "stable";
    confidence: number;
    shortTerm: {
      timeframe: string;
      percentChange: number;
      predictedValue: number;
    };
    mediumTerm: {
      timeframe: string;
      percentChange: number;
      predictedValue: number;
    };
    longTerm: {
      timeframe: string;
      percentChange: number;
      predictedValue: number;
    };
  };
  breakdown: {
    category: string;
    currentValue: number;
    predictedChange: number;
    cardCount: number;
  }[];
  factors: Array<{
    name: string;
    impact: "positive" | "negative" | "neutral";
    weight: number;
    description: string;
  }>;
  riskLevel: "low" | "medium" | "high";
  diversificationScore: number;
  summary: string;
  keyInsight: string;
  topGainers: string[];
  topLosers: string[];
}

interface CollectionValuePredictionProps {
  cards: CollectionCard[];
  totalValue: number;
}

export function CollectionValuePrediction({ cards, totalValue }: CollectionValuePredictionProps) {
  const [prediction, setPrediction] = useState<CollectionPredictionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchPrediction = async () => {
    setIsLoading(true);
    try {
      // Prepare collection summary for the AI
      const gameTypeBreakdown: Record<string, { count: number; value: number }> = {};
      const rarityBreakdown: Record<string, { count: number; value: number }> = {};
      
      cards.forEach(card => {
        const gameType = card.game_type || card.sport_type || "Unknown";
        const rarity = card.rarity || "Unknown";
        const value = card.suggested_price || 0;
        
        if (!gameTypeBreakdown[gameType]) {
          gameTypeBreakdown[gameType] = { count: 0, value: 0 };
        }
        gameTypeBreakdown[gameType].count++;
        gameTypeBreakdown[gameType].value += value;
        
        if (!rarityBreakdown[rarity]) {
          rarityBreakdown[rarity] = { count: 0, value: 0 };
        }
        rarityBreakdown[rarity].count++;
        rarityBreakdown[rarity].value += value;
      });

      // Get top 20 most valuable cards for context
      const topCards = [...cards]
        .sort((a, b) => (b.suggested_price || 0) - (a.suggested_price || 0))
        .slice(0, 20)
        .map(c => ({
          name: c.card_name,
          set: c.card_set,
          rarity: c.rarity,
          value: c.suggested_price,
          gameType: c.game_type || c.sport_type,
        }));

      const { data, error } = await supabase.functions.invoke("predict-collection-value", {
        body: {
          totalCards: cards.length,
          totalValue,
          gameTypeBreakdown,
          rarityBreakdown,
          topCards,
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      setPrediction(data.prediction);
      toast.success("Collection prediction generated!");
    } catch (error) {
      console.error("Prediction error:", error);
      toast.error("Failed to generate collection prediction");
    } finally {
      setIsLoading(false);
    }
  };

  const getDirectionIcon = (direction: string) => {
    switch (direction) {
      case "up":
        return <TrendingUp className="h-6 w-6 text-green-500" />;
      case "down":
        return <TrendingDown className="h-6 w-6 text-red-500" />;
      default:
        return <Minus className="h-6 w-6 text-yellow-500" />;
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case "low":
        return "text-green-400";
      case "medium":
        return "text-yellow-400";
      case "high":
        return "text-red-400";
      default:
        return "text-muted-foreground";
    }
  };

  const formatPrice = (price: number | null | undefined) => {
    if (!price) return "N/A";
    return `$${price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const formatPercent = (percent: number) => {
    const sign = percent >= 0 ? "+" : "";
    return `${sign}${percent.toFixed(1)}%`;
  };

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-indigo-900/20 to-purple-900/20 border-indigo-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-indigo-400 animate-pulse" />
            Analyzing Collection...
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!prediction) {
    return (
      <Card className="bg-gradient-to-br from-indigo-900/20 to-purple-900/20 border-indigo-500/30 hover:border-indigo-400/50 transition-colors">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-indigo-400" />
            Collection Value Predictor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 p-4 bg-background/30 rounded-lg">
            <div className="text-center">
              <p className="text-3xl font-bold text-primary">{cards.length}</p>
              <p className="text-xs text-muted-foreground">Total Cards</p>
            </div>
            <div className="text-center">
              <p className="text-3xl font-bold text-green-400">{formatPrice(totalValue)}</p>
              <p className="text-xs text-muted-foreground">Current Value</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Get AI-powered predictions for your entire collection's future value based on market trends,
            diversification, and category analysis.
          </p>
          <Button
            onClick={fetchPrediction}
            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500"
            disabled={cards.length === 0}
          >
            <Brain className="h-4 w-4 mr-2" />
            Predict Collection Value
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-indigo-900/20 to-purple-900/20 border-indigo-500/30">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-indigo-400" />
            Collection Prediction
          </CardTitle>
          <Badge className="bg-indigo-500/20 text-indigo-400 border-indigo-500/30">
            {cards.length} Cards Analyzed
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Main Direction & Confidence */}
        <div className="flex items-center justify-between p-4 rounded-lg bg-background/50">
          <div className="flex items-center gap-3">
            {getDirectionIcon(prediction.prediction.direction)}
            <div>
              <p className="font-semibold capitalize text-lg">{prediction.prediction.direction} Trend</p>
              <p className="text-xs text-muted-foreground">Collection Direction</p>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-indigo-400" />
              <span className="text-3xl font-bold">{prediction.prediction.confidence}%</span>
            </div>
            <p className="text-xs text-muted-foreground">Confidence</p>
          </div>
        </div>

        {/* Value Predictions Grid */}
        <div className="grid grid-cols-3 gap-3">
          {/* Short Term */}
          <div className="p-4 rounded-lg bg-background/30 border border-border/50">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
              <Clock className="h-3 w-3" />
              {prediction.prediction.shortTerm.timeframe}
            </div>
            <p className={`text-xl font-bold ${
              prediction.prediction.shortTerm.percentChange >= 0 ? "text-green-400" : "text-red-400"
            }`}>
              {formatPercent(prediction.prediction.shortTerm.percentChange)}
            </p>
            <p className="text-sm font-medium mt-1">
              {formatPrice(prediction.prediction.shortTerm.predictedValue)}
            </p>
          </div>

          {/* Medium Term */}
          <div className="p-4 rounded-lg bg-background/30 border border-border/50">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
              <Clock className="h-3 w-3" />
              {prediction.prediction.mediumTerm.timeframe}
            </div>
            <p className={`text-xl font-bold ${
              prediction.prediction.mediumTerm.percentChange >= 0 ? "text-green-400" : "text-red-400"
            }`}>
              {formatPercent(prediction.prediction.mediumTerm.percentChange)}
            </p>
            <p className="text-sm font-medium mt-1">
              {formatPrice(prediction.prediction.mediumTerm.predictedValue)}
            </p>
          </div>

          {/* Long Term */}
          <div className="p-4 rounded-lg bg-background/30 border border-border/50">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
              <Clock className="h-3 w-3" />
              {prediction.prediction.longTerm.timeframe}
            </div>
            <p className={`text-xl font-bold ${
              prediction.prediction.longTerm.percentChange >= 0 ? "text-green-400" : "text-red-400"
            }`}>
              {formatPercent(prediction.prediction.longTerm.percentChange)}
            </p>
            <p className="text-sm font-medium mt-1">
              {formatPrice(prediction.prediction.longTerm.predictedValue)}
            </p>
          </div>
        </div>

        {/* Risk & Diversification */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center justify-between p-3 rounded-lg bg-background/30">
            <div className="flex items-center gap-2">
              <Shield className={`h-4 w-4 ${getRiskColor(prediction.riskLevel)}`} />
              <span className="text-sm">Risk Level</span>
            </div>
            <Badge variant="outline" className={getRiskColor(prediction.riskLevel)}>
              {prediction.riskLevel.toUpperCase()}
            </Badge>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-background/30">
            <div className="flex items-center gap-2">
              <PieChart className="h-4 w-4 text-indigo-400" />
              <span className="text-sm">Diversification</span>
            </div>
            <Badge variant="outline" className="text-indigo-400 border-indigo-500/30">
              {prediction.diversificationScore}/10
            </Badge>
          </div>
        </div>

        {/* Category Breakdown */}
        {prediction.breakdown && prediction.breakdown.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-indigo-400" />
              Category Breakdown
            </h4>
            <div className="space-y-2">
              {prediction.breakdown.slice(0, 4).map((cat, idx) => (
                <div key={idx} className="p-2 rounded bg-background/30 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium">{cat.category}</span>
                    <span className="text-xs text-muted-foreground ml-2">({cat.cardCount} cards)</span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm">{formatPrice(cat.currentValue)}</span>
                    <span className={`text-xs ml-2 ${cat.predictedChange >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {formatPercent(cat.predictedChange)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top Gainers/Losers */}
        {(prediction.topGainers?.length > 0 || prediction.topLosers?.length > 0) && (
          <div className="grid grid-cols-2 gap-3">
            {prediction.topGainers?.length > 0 && (
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <p className="text-xs font-semibold text-green-400 mb-2 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> Top Gainers
                </p>
                <ul className="space-y-1">
                  {prediction.topGainers.slice(0, 3).map((name, idx) => (
                    <li key={idx} className="text-xs truncate">{name}</li>
                  ))}
                </ul>
              </div>
            )}
            {prediction.topLosers?.length > 0 && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-xs font-semibold text-red-400 mb-2 flex items-center gap-1">
                  <TrendingDown className="h-3 w-3" /> At Risk
                </p>
                <ul className="space-y-1">
                  {prediction.topLosers.slice(0, 3).map((name, idx) => (
                    <li key={idx} className="text-xs truncate">{name}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Key Factors */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-indigo-400" />
            Market Factors
          </h4>
          <div className="space-y-2">
            {prediction.factors.slice(0, 3).map((factor, idx) => (
              <div key={idx} className="p-2 rounded bg-background/30">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{factor.name}</span>
                  <Badge
                    variant="outline"
                    className={
                      factor.impact === "positive"
                        ? "text-green-400 border-green-500/30"
                        : factor.impact === "negative"
                        ? "text-red-400 border-red-500/30"
                        : "text-yellow-400 border-yellow-500/30"
                    }
                  >
                    {factor.impact}
                  </Badge>
                </div>
                <Progress value={factor.weight * 10} className="h-1.5" />
                <p className="text-xs text-muted-foreground mt-1">{factor.description}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Key Insight */}
        <div className="p-4 rounded-lg bg-gradient-to-r from-amber-900/20 to-orange-900/20 border border-amber-500/30">
          <div className="flex items-start gap-3">
            <Lightbulb className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-amber-400 mb-1">Collection Insight</h4>
              <p className="text-sm">{prediction.keyInsight}</p>
            </div>
          </div>
        </div>

        {/* Summary */}
        <p className="text-sm text-muted-foreground italic">{prediction.summary}</p>

        {/* Regenerate Button */}
        <Button
          variant="outline"
          size="sm"
          onClick={fetchPrediction}
          className="w-full"
        >
          <Zap className="h-4 w-4 mr-2" />
          Refresh Prediction
        </Button>
      </CardContent>
    </Card>
  );
}
