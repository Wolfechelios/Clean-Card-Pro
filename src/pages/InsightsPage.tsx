import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, TrendingDown, Minus, AlertCircle, Lightbulb, Shield, DollarSign } from "lucide-react";
import { getCollectionInsights, CollectionInsights } from "@/lib/collectionInsights";
import { useToast } from "@/hooks/use-toast";

export default function InsightsPage() {
  const [insights, setInsights] = useState<CollectionInsights | null>(null);
  const [collectionStats, setCollectionStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchInsights = async () => {
    setLoading(true);
    try {
      const data = await getCollectionInsights();
      setInsights(data.insights);
      setCollectionStats(data.collectionStats);
    } catch (error) {
      console.error("Error fetching insights:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to load insights",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInsights();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Collection Insights</CardTitle>
            <CardDescription>AI-powered analysis of your collection</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Unable to load insights. Please try again.</p>
            <Button onClick={fetchInsights} className="mt-4">
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high":
        return "destructive";
      case "medium":
        return "default";
      case "low":
        return "secondary";
      default:
        return "default";
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case "up":
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case "down":
        return <TrendingDown className="h-4 w-4 text-red-500" />;
      case "stable":
        return <Minus className="h-4 w-4 text-yellow-500" />;
      default:
        return null;
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "buy":
        return <DollarSign className="h-4 w-4" />;
      case "sell":
        return <TrendingUp className="h-4 w-4" />;
      case "grade":
        return <Shield className="h-4 w-4" />;
      case "protect":
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <Lightbulb className="h-4 w-4" />;
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Collection Insights</h1>
          <p className="text-muted-foreground mt-1">AI-powered analysis of your collection</p>
        </div>
        <Button onClick={fetchInsights} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Refresh
        </Button>
      </div>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-lg">{insights.summary}</p>
          {collectionStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <div>
                <p className="text-sm text-muted-foreground">Total Cards</p>
                <p className="text-2xl font-bold">{collectionStats.totalCards}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Value</p>
                <p className="text-2xl font-bold">${collectionStats.totalValue?.toFixed(2) || "0.00"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Average Value</p>
                <p className="text-2xl font-bold">${collectionStats.avgValue?.toFixed(2) || "0.00"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Card Types</p>
                <p className="text-2xl font-bold">
                  {[...(collectionStats.gameTypes || []), ...(collectionStats.sportTypes || [])].length}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Value Analysis */}
      {insights.valueAnalysis && (
        <Card>
          <CardHeader>
            <CardTitle>Value Analysis</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Current Value</p>
                <p className="text-xl font-bold">{insights.valueAnalysis.currentValue}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Potential Value</p>
                <p className="text-xl font-bold">{insights.valueAnalysis.potentialValue}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Risk Level</p>
                <Badge variant={insights.valueAnalysis.riskLevel === "high" ? "destructive" : "default"}>
                  {insights.valueAnalysis.riskLevel.toUpperCase()}
                </Badge>
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-2">Diversification</p>
              <p>{insights.valueAnalysis.diversification}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-semibold mb-2">Strengths</p>
                <ul className="space-y-1">
                  {insights.valueAnalysis.strengths.map((strength, idx) => (
                    <li key={idx} className="text-sm flex items-start gap-2">
                      <span className="text-green-500">✓</span>
                      {strength}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-sm font-semibold mb-2">Weaknesses</p>
                <ul className="space-y-1">
                  {insights.valueAnalysis.weaknesses.map((weakness, idx) => (
                    <li key={idx} className="text-sm flex items-start gap-2">
                      <span className="text-red-500">!</span>
                      {weakness}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle>Recommendations</CardTitle>
          <CardDescription>AI-generated actionable insights</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {insights.recommendations.map((rec, idx) => (
              <div key={idx} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getTypeIcon(rec.type)}
                    <h3 className="font-semibold">{rec.title}</h3>
                  </div>
                  <Badge variant={getPriorityColor(rec.priority)}>{rec.priority}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{rec.description}</p>
                {rec.specificCards && rec.specificCards.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-semibold mb-1">Specific Cards:</p>
                    <div className="flex flex-wrap gap-1">
                      {rec.specificCards.map((card, cardIdx) => (
                        <Badge key={cardIdx} variant="outline" className="text-xs">
                          {card}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Market Trends */}
      <Card>
        <CardHeader>
          <CardTitle>Market Trends</CardTitle>
          <CardDescription>Current market conditions affecting your collection</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {insights.marketTrends.map((trend, idx) => (
              <div key={idx} className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{trend.category}</h3>
                  {getTrendIcon(trend.trend)}
                </div>
                <p className="text-sm text-muted-foreground">{trend.description}</p>
                <div className="bg-muted p-2 rounded text-sm">
                  <span className="font-semibold">Impact: </span>
                  {trend.impact}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
