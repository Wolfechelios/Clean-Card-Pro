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
  AlertTriangle,
  Shield,
  Target,
  Zap,
  DollarSign,
  Clock,
  BarChart3,
  Lightbulb,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CardData {
  id: string;
  card_name: string;
  card_set?: string | null;
  card_number?: string | null;
  rarity?: string | null;
  game_type?: string | null;
  sport_type?: string | null;
  current_price_raw?: number | null;
  current_price_psa9?: number | null;
  current_price_psa10?: number | null;
}

interface PredictionData {
  prediction: {
    direction: "up" | "down" | "stable";
    confidence: number;
    shortTerm: {
      timeframe: string;
      percentChange: number;
      predictedRaw: number;
      predictedPsa9: number;
      predictedPsa10: number;
    };
    mediumTerm: {
      timeframe: string;
      percentChange: number;
      predictedRaw: number;
      predictedPsa9: number;
      predictedPsa10: number;
    };
    longTerm: {
      timeframe: string;
      percentChange: number;
      predictedRaw: number;
      predictedPsa9: number;
      predictedPsa10: number;
    };
  };
  factors: Array<{
    name: string;
    impact: "positive" | "negative" | "neutral";
    weight: number;
    description: string;
  }>;
  riskLevel: "low" | "medium" | "high";
  investmentRating: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  summary: string;
  keyInsight: string;
}

interface ValuePredictionProps {
  card: CardData;
  priceHistory?: Array<{
    price_raw?: number | null;
    price_psa9?: number | null;
    price_psa10?: number | null;
    recorded_at: string;
  }>;
}

export function ValuePrediction({ card, priceHistory }: ValuePredictionProps) {
  const [prediction, setPrediction] = useState<PredictionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchPrediction = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("predict-card-value", {
        body: {
          card: {
            card_name: card.card_name,
            card_set: card.card_set,
            card_number: card.card_number,
            rarity: card.rarity,
            game_type: card.game_type,
            sport_type: card.sport_type,
            current_price_raw: card.current_price_raw,
            current_price_psa9: card.current_price_psa9,
            current_price_psa10: card.current_price_psa10,
          },
          priceHistory: priceHistory?.map(p => ({
            price_raw: p.price_raw,
            price_psa9: p.price_psa9,
            price_psa10: p.price_psa10,
            recorded_at: p.recorded_at,
          })),
        },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      setPrediction(data.prediction);
      toast.success("AI prediction generated!");
    } catch (error) {
      console.error("Prediction error:", error);
      toast.error("Failed to generate prediction");
    } finally {
      setIsLoading(false);
    }
  };

  const getDirectionIcon = (direction: string) => {
    switch (direction) {
      case "up":
        return <TrendingUp className="h-5 w-5 text-green-500" />;
      case "down":
        return <TrendingDown className="h-5 w-5 text-red-500" />;
      default:
        return <Minus className="h-5 w-5 text-yellow-500" />;
    }
  };

  const getRatingColor = (rating: string) => {
    switch (rating) {
      case "strong_buy":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      case "buy":
        return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
      case "hold":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "sell":
        return "bg-orange-500/20 text-orange-400 border-orange-500/30";
      case "strong_sell":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      default:
        return "bg-muted text-muted-foreground";
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

  const formatRating = (rating: string) => {
    return rating.replace(/_/g, " ").toUpperCase();
  };

  const formatPrice = (price: number | null | undefined) => {
    if (!price) return "N/A";
    return `$${price.toFixed(2)}`;
  };

  const formatPercent = (percent: number) => {
    const sign = percent >= 0 ? "+" : "";
    return `${sign}${percent.toFixed(1)}%`;
  };

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 border-purple-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-400 animate-pulse" />
            Analyzing Market Data...
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!prediction) {
    return (
      <Card className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 border-purple-500/30 hover:border-purple-400/50 transition-colors">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-400" />
            AI Value Predictor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Get AI-powered predictions for this card's future value based on market trends,
            historical data, and collector demand patterns.
          </p>
          <Button
            onClick={fetchPrediction}
            className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500"
          >
            <Brain className="h-4 w-4 mr-2" />
            Generate Prediction
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 border-purple-500/30">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-400" />
            AI Value Prediction
          </CardTitle>
          <Badge className={getRatingColor(prediction.investmentRating)}>
            {formatRating(prediction.investmentRating)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Main Direction & Confidence */}
        <div className="flex items-center justify-between p-4 rounded-lg bg-background/50">
          <div className="flex items-center gap-3">
            {getDirectionIcon(prediction.prediction.direction)}
            <div>
              <p className="font-semibold capitalize">{prediction.prediction.direction} Trend</p>
              <p className="text-xs text-muted-foreground">Predicted Direction</p>
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-purple-400" />
              <span className="text-2xl font-bold">{prediction.prediction.confidence}%</span>
            </div>
            <p className="text-xs text-muted-foreground">Confidence</p>
          </div>
        </div>

        {/* Price Predictions Grid */}
        <div className="grid grid-cols-3 gap-3">
          {/* Short Term */}
          <div className="p-3 rounded-lg bg-background/30 border border-border/50">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
              <Clock className="h-3 w-3" />
              {prediction.prediction.shortTerm.timeframe}
            </div>
            <p className={`text-lg font-bold ${
              prediction.prediction.shortTerm.percentChange >= 0 ? "text-green-400" : "text-red-400"
            }`}>
              {formatPercent(prediction.prediction.shortTerm.percentChange)}
            </p>
            <div className="mt-2 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Raw:</span>
                <span>{formatPrice(prediction.prediction.shortTerm.predictedRaw)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">PSA 9:</span>
                <span>{formatPrice(prediction.prediction.shortTerm.predictedPsa9)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">PSA 10:</span>
                <span>{formatPrice(prediction.prediction.shortTerm.predictedPsa10)}</span>
              </div>
            </div>
          </div>

          {/* Medium Term */}
          <div className="p-3 rounded-lg bg-background/30 border border-border/50">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
              <Clock className="h-3 w-3" />
              {prediction.prediction.mediumTerm.timeframe}
            </div>
            <p className={`text-lg font-bold ${
              prediction.prediction.mediumTerm.percentChange >= 0 ? "text-green-400" : "text-red-400"
            }`}>
              {formatPercent(prediction.prediction.mediumTerm.percentChange)}
            </p>
            <div className="mt-2 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Raw:</span>
                <span>{formatPrice(prediction.prediction.mediumTerm.predictedRaw)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">PSA 9:</span>
                <span>{formatPrice(prediction.prediction.mediumTerm.predictedPsa9)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">PSA 10:</span>
                <span>{formatPrice(prediction.prediction.mediumTerm.predictedPsa10)}</span>
              </div>
            </div>
          </div>

          {/* Long Term */}
          <div className="p-3 rounded-lg bg-background/30 border border-border/50">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
              <Clock className="h-3 w-3" />
              {prediction.prediction.longTerm.timeframe}
            </div>
            <p className={`text-lg font-bold ${
              prediction.prediction.longTerm.percentChange >= 0 ? "text-green-400" : "text-red-400"
            }`}>
              {formatPercent(prediction.prediction.longTerm.percentChange)}
            </p>
            <div className="mt-2 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Raw:</span>
                <span>{formatPrice(prediction.prediction.longTerm.predictedRaw)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">PSA 9:</span>
                <span>{formatPrice(prediction.prediction.longTerm.predictedPsa9)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">PSA 10:</span>
                <span>{formatPrice(prediction.prediction.longTerm.predictedPsa10)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Risk Level */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-background/30">
          <div className="flex items-center gap-2">
            <Shield className={`h-4 w-4 ${getRiskColor(prediction.riskLevel)}`} />
            <span className="text-sm">Risk Level</span>
          </div>
          <Badge variant="outline" className={getRiskColor(prediction.riskLevel)}>
            {prediction.riskLevel.toUpperCase()}
          </Badge>
        </div>

        {/* Key Factors */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-purple-400" />
            Market Factors
          </h4>
          <div className="space-y-2">
            {prediction.factors.slice(0, 4).map((factor, idx) => (
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
              <h4 className="text-sm font-semibold text-amber-400 mb-1">Hidden Insight</h4>
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
