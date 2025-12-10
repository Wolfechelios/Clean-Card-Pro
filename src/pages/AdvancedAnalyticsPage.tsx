import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  Award, 
  RefreshCw, 
  Loader2,
  PieChart,
  Target,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Shield
} from "lucide-react";
import { 
  PieChart as RechartsPie, 
  Pie, 
  Cell, 
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend
} from "recharts";

type AnalyticsType = "collection" | "market" | "grading";

export default function AdvancedAnalyticsPage() {
  const { userId } = useAuth();
  const [activeTab, setActiveTab] = useState<AnalyticsType>("collection");
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<Record<AnalyticsType, any>>({
    collection: null,
    market: null,
    grading: null,
  });

  const fetchAnalytics = useCallback(async (type: AnalyticsType) => {
    if (!userId) return;

    setIsLoading(true);
    try {
      const { data: result, error } = await supabase.functions.invoke("advanced-analytics", {
        body: { analyticsType: type },
      });

      if (error) throw error;

      if (result.success) {
        setData((prev) => ({ ...prev, [type]: result }));
      } else {
        throw new Error(result.error || "Failed to fetch analytics");
      }
    } catch (error) {
      console.error("Analytics error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to load analytics");
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId && !data[activeTab]) {
      fetchAnalytics(activeTab);
    }
  }, [activeTab, userId, fetchAnalytics, data]);

  const CHART_COLORS = ["hsl(var(--primary))", "hsl(var(--secondary))", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

  const getTrendIcon = (trend: string) => {
    if (trend === "up" || trend === "bullish") return <TrendingUp className="h-4 w-4 text-success" />;
    if (trend === "down" || trend === "bearish") return <TrendingDown className="h-4 w-4 text-destructive" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };

  const getPriorityBadge = (priority: string) => {
    const variants: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
      high: "destructive",
      medium: "default",
      low: "secondary",
    };
    return <Badge variant={variants[priority] || "outline"}>{priority}</Badge>;
  };

  const renderCollectionAnalytics = () => {
    const analytics = data.collection;
    if (!analytics) return null;

    const { stats, analysis } = analytics;
    const rarityData = Object.entries(stats.rarityDistribution || {}).map(([name, value]) => ({
      name,
      value,
    }));
    const gameData = Object.entries(stats.gameDistribution || {}).map(([name, value]) => ({
      name,
      value,
    }));

    return (
      <div className="space-y-6">
        {/* Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{stats.totalCards}</div>
              <div className="text-sm text-muted-foreground">Total Cards</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold text-success">${stats.totalValue?.toFixed(2)}</div>
              <div className="text-sm text-muted-foreground">Total Value</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">${stats.avgValue?.toFixed(2)}</div>
              <div className="text-sm text-muted-foreground">Avg Card Value</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="text-2xl font-bold capitalize">{analysis?.overview?.collectionHealth || "N/A"}</div>
              <div className="text-sm text-muted-foreground">Health Score</div>
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Rarity Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsPie>
                    <Pie
                      data={rarityData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    >
                      {rarityData.map((_, index) => (
                        <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </RechartsPie>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Game/Sport Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={gameData} layout="vertical">
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* AI Insights */}
        {analysis && !analysis.parseError && (
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Strengths & Weaknesses
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium text-success mb-2">Strengths</h4>
                  <ul className="space-y-1">
                    {analysis.strengths?.map((s: string, i: number) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <ArrowUpRight className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-destructive mb-2">Weaknesses</h4>
                  <ul className="space-y-1">
                    {analysis.weaknesses?.map((w: string, i: number) => (
                      <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                        <ArrowDownRight className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Recommendations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {analysis.recommendations?.map((rec: any, i: number) => (
                    <div key={i} className="p-3 rounded-lg bg-muted/50 border border-border">
                      <div className="flex items-center justify-between mb-1">
                        <Badge variant="outline" className="capitalize">{rec.type}</Badge>
                        {getPriorityBadge(rec.priority)}
                      </div>
                      <p className="text-sm text-muted-foreground">{rec.description}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    );
  };

  const renderMarketAnalytics = () => {
    const analytics = data.market;
    if (!analytics) return null;

    const { analysis } = analytics;

    return (
      <div className="space-y-6">
        {/* Market Overview */}
        {analysis?.marketOverview && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {getTrendIcon(analysis.marketOverview.trend)}
                Market Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-4 mb-4">
                <div className="p-4 rounded-lg bg-muted/50">
                  <div className="text-lg font-semibold capitalize flex items-center gap-2">
                    {getTrendIcon(analysis.marketOverview.trend)}
                    {analysis.marketOverview.trend}
                  </div>
                  <div className="text-sm text-muted-foreground">Market Trend</div>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <div className="text-lg font-semibold capitalize">{analysis.marketOverview.volatility}</div>
                  <div className="text-sm text-muted-foreground">Volatility</div>
                </div>
                <div className="p-4 rounded-lg bg-muted/50 md:col-span-1">
                  <p className="text-sm">{analysis.marketOverview.summary}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Trending Categories */}
        {analysis?.trendingCategories && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Trending Categories</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {analysis.trendingCategories.map((cat: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div className="flex items-center gap-3">
                      {getTrendIcon(cat.trend)}
                      <span className="font-medium">{cat.category}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress value={cat.momentum} className="w-24" />
                      <span className="text-sm text-muted-foreground">{cat.momentum}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Timing Recommendations */}
        {analysis?.timingRecommendations && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Timing Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {analysis.timingRecommendations.map((rec: any, i: number) => (
                  <div key={i} className="p-4 rounded-lg border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={rec.action === "buy" ? "default" : rec.action === "sell" ? "destructive" : "secondary"} className="capitalize">
                          {rec.action}
                        </Badge>
                        <span className="font-medium">{rec.category}</span>
                      </div>
                      {getPriorityBadge(rec.urgency)}
                    </div>
                    <p className="text-sm text-muted-foreground">{rec.reasoning}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  const renderGradingAnalytics = () => {
    const analytics = data.grading;
    if (!analytics) return null;

    const { stats, analysis } = analytics;

    const conditionData = Object.entries(stats.conditionDistribution || {}).map(([name, value]) => ({
      name,
      value,
    }));

    return (
      <div className="space-y-6">
        {/* Grading Overview */}
        {analysis?.gradingOverview && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold">{analysis.gradingOverview.gradedPercentage?.toFixed(1)}%</div>
                <div className="text-sm text-muted-foreground">Graded</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-success">+${analysis.gradingOverview.potentialUplift?.toFixed(0)}</div>
                <div className="text-sm text-muted-foreground">Potential Uplift</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold">{analysis.gradingOverview.recommendedSubmissions}</div>
                <div className="text-sm text-muted-foreground">Recommended Submissions</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 col-span-2 md:col-span-1">
                <p className="text-sm">{analysis.gradingOverview.summary}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Condition Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Condition Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={conditionData}>
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Grading Candidates */}
        {analysis?.topGradingCandidates && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Award className="h-5 w-5" />
                Top Grading Candidates
              </CardTitle>
              <CardDescription>Cards with the highest potential value uplift from grading</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {analysis.topGradingCandidates.map((card: any, i: number) => (
                  <div key={i} className="p-4 rounded-lg border border-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">{card.cardName}</span>
                      {getPriorityBadge(card.gradingPriority)}
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm mb-2">
                      <div>
                        <span className="text-muted-foreground">Current:</span>{" "}
                        <span className="font-medium">${card.currentValue?.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">PSA 9:</span>{" "}
                        <span className="font-medium text-success">${card.estimatedPSA9Value?.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">PSA 10:</span>{" "}
                        <span className="font-medium text-success">${card.estimatedPSA10Value?.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">{card.reasoning}</span>
                      <Badge variant="outline" className="text-success">+{card.upliftPotential?.toFixed(0)}% uplift</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Grading Service Recommendation */}
        {analysis?.gradingServiceRecommendation && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Recommended Grading Service
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="p-4 rounded-lg bg-primary/10 border border-primary/20">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xl font-bold">{analysis.gradingServiceRecommendation.service}</span>
                  <div className="text-right">
                    <div className="text-sm text-muted-foreground">Est. Cost</div>
                    <div className="font-medium">${analysis.gradingServiceRecommendation.estimatedCost}</div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mb-2">{analysis.gradingServiceRecommendation.reason}</p>
                <div className="text-sm">
                  <span className="text-muted-foreground">Turnaround:</span>{" "}
                  {analysis.gradingServiceRecommendation.estimatedTurnaround}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Advanced Analytics</h1>
            <p className="text-muted-foreground">Deep insights into your collection</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchAnalytics(activeTab)}
          disabled={isLoading}
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AnalyticsType)}>
        <TabsList className="w-full md:w-auto">
          <TabsTrigger value="collection" className="flex-1 md:flex-none gap-2">
            <PieChart className="h-4 w-4" />
            <span className="hidden sm:inline">Collection</span>
          </TabsTrigger>
          <TabsTrigger value="market" className="flex-1 md:flex-none gap-2">
            <TrendingUp className="h-4 w-4" />
            <span className="hidden sm:inline">Market</span>
          </TabsTrigger>
          <TabsTrigger value="grading" className="flex-1 md:flex-none gap-2">
            <Award className="h-4 w-4" />
            <span className="hidden sm:inline">Grading</span>
          </TabsTrigger>
        </TabsList>

        {isLoading && !data[activeTab] ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <TabsContent value="collection" className="mt-6">
              {renderCollectionAnalytics()}
            </TabsContent>
            <TabsContent value="market" className="mt-6">
              {renderMarketAnalytics()}
            </TabsContent>
            <TabsContent value="grading" className="mt-6">
              {renderGradingAnalytics()}
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
