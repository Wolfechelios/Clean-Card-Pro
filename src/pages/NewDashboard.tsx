import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database } from "@/integrations/supabase/types";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Package,
  Star,
  RefreshCw,
  Scan as ScanIcon,
  BookOpen,
  Camera,
  Activity,
  Zap,
  Sparkles,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  Target,
  AlertTriangle,
  Gem,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { analyzeCardFull } from "@/lib/analyzeCardFull";
import { DashboardSkeleton } from "@/components/ui/loading-skeletons";
import { CardDetailModal, CardData } from "@/components/cards/CardDetailModal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useGlobalProcessControl } from "@/hooks/use-global-process-control";
import { RecentScansBox } from "@/components/scanner/RecentScansBox";

type CardType = Database["public"]["Tables"]["cards"]["Row"];

interface DashboardStats {
  totalCards: number;
  totalValue: number;
  recentScans: number;
  avgCardValue: number;
  topRarity: string;
  valueChange: number;
  collectorSaleValue: number;
  cardsWithPrices: number;
}

interface ChartData {
  name: string;
  value: number;
  count?: number;
}

interface BulkScanResult {
  imageUrl: string;
  status: "pending" | "success" | "error";
  error?: string;
}

export default function NewDashboard() {
  const { userId, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { scannerActive } = useGlobalProcessControl();
  const [stats, setStats] = useState<DashboardStats>({
    totalCards: 0,
    totalValue: 0,
    recentScans: 0,
    avgCardValue: 0,
    topRarity: "N/A",
    valueChange: 0,
    collectorSaleValue: 0,
    cardsWithPrices: 0,
  });
  const [recentCards, setRecentCards] = useState<CardType[]>([]);
  const [rarityData, setRarityData] = useState<ChartData[]>([]);
  const [conditionData, setConditionData] = useState<ChartData[]>([]);
  const [valueOverTime, setValueOverTime] = useState<ChartData[]>([]);
  const [topCards, setTopCards] = useState<CardType[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Scan-center state
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkItems, setBulkItems] = useState<BulkScanResult[]>([]);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState<CardData | null>(null);
  const [showCardDetail, setShowCardDetail] = useState(false);
  const [aiAdvice, setAiAdvice] = useState<string | null>(null);
  const [aiAdviceLoading, setAiAdviceLoading] = useState(false);
  const [allCards, setAllCards] = useState<CardType[]>([]);
  
  // PSA10 viability analysis state
  const [psa10AnalysisRunning, setPsa10AnalysisRunning] = useState(false);
  const [psa10AnalysisProgress, setPsa10AnalysisProgress] = useState({ processed: 0, total: 0, viable: 0 });
  // Dashboard refresh throttling (prevents crashes during rapid scanning)
  const refreshTimerRef = useRef<number | null>(null);
  const refreshInFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const scannerActiveRef = useRef(scannerActive);

  const triggerDashboardRefresh = useCallback(() => {
    // If scanning is active, postpone refresh until scanning stops
    if (scannerActiveRef.current) {
      pendingRefreshRef.current = true;
      return;
    }

    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);

    // Debounce realtime-driven refreshes (rapid scans can emit many updates per second)
    refreshTimerRef.current = window.setTimeout(async () => {
      if (refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      try {
        await fetchDashboardData();
      } finally {
        refreshInFlightRef.current = false;
      }
    }, 2000);
  }, [userId]);

  useEffect(() => {
    scannerActiveRef.current = scannerActive;
    if (!scannerActive && pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      triggerDashboardRefresh();
    }
  }, [scannerActive, triggerDashboardRefresh]);

  useEffect(() => {
    if (authLoading) return;

    triggerDashboardRefresh();

    // Real-time subscription for card changes (throttled)
    const channel = supabase
      .channel("dashboard-cards-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cards",
        },
        () => {
          triggerDashboardRefresh();
        }
      )
      .subscribe();

    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [authLoading, userId, triggerDashboardRefresh]);

  const fetchDashboardData = async () => {
    if (!userId) {
      setIsInitialLoading(false);
      setIsRefreshing(false);
      return;
    }
    
    setIsRefreshing(true);

    const allCards: CardType[] = [];
    const pageSize = 1000;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: cards, error } = await supabase
        .from("cards")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) {
        console.error("Error fetching cards:", error);
        break;
      }

      if (cards && cards.length > 0) {
        const fixed = cards.map(c => ({
          ...c,
          image_url: toPublicImageUrl(c.image_url),
          thumbnail_url: c.thumbnail_url ? toPublicImageUrl(c.thumbnail_url) : c.thumbnail_url,
        }));
        allCards.push(...fixed);
        page++;
        hasMore = cards.length === pageSize;
      } else {
        hasMore = false;
      }
    }

    if (allCards.length > 0) {
      const cards = allCards;
      const totalValue = cards.reduce((sum, card) => sum + (card.current_price_raw || 0) * (card.quantity || 1), 0);
      const totalCards = cards.reduce((sum, card) => sum + (card.quantity || 1), 0);
      const avgValue = totalCards > 0 ? totalValue / totalCards : 0;

      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentScans = cards
        .filter((c) => new Date(c.created_at) > dayAgo)
        .reduce((sum, card) => sum + (card.quantity || 1), 0);

      const rarityCounts = cards.reduce(
        (acc, card) => {
          const rarity = card.rarity || "Unknown";
          acc[rarity] = (acc[rarity] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      const topRarity = Object.entries(rarityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

      const recentValue = cards
        .filter((c) => new Date(c.created_at) > sevenDaysAgo)
        .reduce((sum, card) => sum + (card.current_price_raw || 0) * (card.quantity || 1), 0);

      const previousValue = cards
        .filter((c) => {
          const date = new Date(c.created_at);
          return date > fourteenDaysAgo && date <= sevenDaysAgo;
        })
        .reduce((sum, card) => sum + (card.current_price_raw || 0) * (card.quantity || 1), 0);

      const valueChange = previousValue > 0 ? ((recentValue - previousValue) / previousValue) * 100 : 0;

      // Calculate realistic collector sale value (what you could sell for today)
      // Raw cards: ~75% of market (collector margin), graded: closer to market
      const cardsWithPrices = cards.filter(c => c.current_price_raw && c.current_price_raw > 0);
      const collectorSaleValue = cards.reduce((sum, card) => {
        const rawPrice = card.current_price_raw || 0;
        const qty = card.quantity || 1;
        // Collector-to-collector typically 70-80% of market for raw cards
        return sum + (rawPrice * 0.75 * qty);
      }, 0);

      setStats({
        totalCards: totalCards,
        totalValue,
        recentScans,
        avgCardValue: avgValue,
        topRarity,
        valueChange,
        collectorSaleValue,
        cardsWithPrices: cardsWithPrices.length,
      });

      setAllCards(cards);
      setRecentCards(cards.slice(0, 200));

      const sorted = [...cards].sort((a, b) => (b.current_price_raw || 0) - (a.current_price_raw || 0));
      setTopCards(sorted.slice(0, 100));

      const rarityChartData = Object.entries(rarityCounts).map(([name, count]) => ({
        name,
        value: count,
        count,
      }));
      setRarityData(rarityChartData);

      const conditionCounts = cards.reduce(
        (acc, card) => {
          const condition = card.condition || "ungraded";
          acc[condition] = (acc[condition] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      const conditionChartData = Object.entries(conditionCounts).map(([name, count]) => ({
        name,
        value: count,
        count,
      }));
      setConditionData(conditionChartData);

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const dailyValues: Record<string, number> = {};

      cards
        .filter((c) => new Date(c.created_at) > thirtyDaysAgo)
        .forEach((card) => {
          const date = new Date(card.created_at).toLocaleDateString();
          dailyValues[date] = (dailyValues[date] || 0) + (card.current_price_raw || 0) * (card.quantity || 1);
        });

      const valueTimeData = Object.entries(dailyValues)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => new Date(a.name).getTime() - new Date(b.name).getTime())
        .slice(-7);

      setValueOverTime(valueTimeData);
    }
    setIsInitialLoading(false);
    setIsRefreshing(false);
  };

  const COLORS = ["hsl(173, 80%, 50%)", "hsl(262, 83%, 58%)", "hsl(152, 76%, 43%)", "hsl(38, 92%, 50%)", "hsl(210, 80%, 55%)", "hsl(330, 80%, 55%)"];

  const getAIAdvice = async () => {
    if (allCards.length === 0) {
      toast.error("No cards in collection to analyze");
      return;
    }

    setAiAdviceLoading(true);
    setAiAdvice(null);

    try {
      // Prepare collection summary for AI
      const totalValue = allCards.reduce((sum, c) => sum + (c.current_price_raw || 0) * (c.quantity || 1), 0);
      const topValueCards = [...allCards].sort((a, b) => (b.current_price_raw || 0) - (a.current_price_raw || 0)).slice(0, 20);
      const lowValueCards = [...allCards].sort((a, b) => (a.current_price_raw || 0) - (b.current_price_raw || 0)).slice(0, 20);
      
      const rarityCounts = allCards.reduce((acc, card) => {
        const r = card.rarity || "Unknown";
        acc[r] = (acc[r] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const setCounts = allCards.reduce((acc, card) => {
        const s = card.card_set || "Unknown";
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const collectionSummary = {
        totalCards: allCards.length,
        totalValue: totalValue.toFixed(2),
        avgCardValue: (totalValue / allCards.length).toFixed(2),
        topCards: topValueCards.map(c => ({ name: c.card_name, set: c.card_set, value: c.current_price_raw, rarity: c.rarity })),
        lowValueCards: lowValueCards.filter(c => (c.current_price_raw || 0) < 5).map(c => ({ name: c.card_name, set: c.card_set, value: c.current_price_raw })),
        rarityDistribution: rarityCounts,
        topSets: Object.entries(setCounts).sort((a, b) => b[1] - a[1]).slice(0, 10),
      };

      const { data, error } = await supabase.functions.invoke("collection-advisor", {
        body: { collectionSummary }
      });

      if (error) throw error;
      
      setAiAdvice(data.advice);
    } catch (err: any) {
      console.error("AI Advice error:", err);
      toast.error("Failed to get AI advice: " + (err.message || "Unknown error"));
    } finally {
      setAiAdviceLoading(false);
    }
  };

  const handleBulkFilesChange: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setBulkError(null);
    setBulkItems([]);
    setBulkProgress(0);
    setBulkUploading(true);

    try {
      const initial: BulkScanResult[] = Array.from(files).map(() => ({
        imageUrl: "",
        status: "pending",
      }));
      setBulkItems(initial);

      const total = files.length;
      const updated: BulkScanResult[] = [];
      let completed = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let item: BulkScanResult = {
          imageUrl: "",
          status: "pending",
        };

        try {
          const ext = file.name.split(".").pop() ?? "jpg";
          const filePath = `bulk/${crypto.randomUUID()}.${ext}`;

          const { error: uploadError } = await supabase.storage.from("card-images").upload(filePath, file, {
            cacheControl: "3600",
            upsert: false,
          });

          if (uploadError) {
            throw new Error(uploadError.message);
          }

          const { data } = supabase.storage.from("card-images").getPublicUrl(filePath);
          const publicUrl = data.publicUrl;
          item.imageUrl = publicUrl;

          await analyzeCardFull(publicUrl);

          item.status = "success";
        } catch (err: any) {
          item.status = "error";
          item.error = err?.message ?? "Scan failed.";
        }

        updated.push(item);
        completed += 1;
        setBulkItems([...updated, ...initial.slice(i + 1)]);
        setBulkProgress(Math.round((completed / total) * 100));
      }
    } catch (err: any) {
      setBulkError(err?.message ?? "Bulk scan failed.");
    } finally {
      setBulkUploading(false);
    }
  };

  // Analyze cards for PSA 10 viability using AI vision
  const handlePsa10Analysis = async () => {
    if (allCards.length === 0) {
      toast.error("No cards to analyze");
      return;
    }

    // Only analyze cards with images that haven't been analyzed yet
    const cardsToAnalyze = allCards.filter(
      c => c.image_url && !c.image_url.includes('placeholder') && c.psa10_viable === null
    );

    if (cardsToAnalyze.length === 0) {
      toast.info("All cards have already been analyzed for PSA 10 viability");
      return;
    }

    setPsa10AnalysisRunning(true);
    setPsa10AnalysisProgress({ processed: 0, total: cardsToAnalyze.length, viable: 0 });

    let processed = 0;
    let viable = 0;

    // Process in batches of 5 to avoid rate limits
    const batchSize = 5;
    for (let i = 0; i < cardsToAnalyze.length; i += batchSize) {
      const batch = cardsToAnalyze.slice(i, i + batchSize);
      
      const results = await Promise.allSettled(
        batch.map(async (card) => {
          try {
            const { data, error } = await supabase.functions.invoke("analyze-psa10-viability", {
              body: { card_id: card.id }
            });
            
            if (error) throw error;
            return data;
          } catch (err) {
            console.error(`Failed to analyze card ${card.id}:`, err);
            return null;
          }
        })
      );

      for (const result of results) {
        processed++;
        if (result.status === 'fulfilled' && result.value?.psa10_viable) {
          viable++;
        }
      }

      setPsa10AnalysisProgress({ processed, total: cardsToAnalyze.length, viable });

      // Small delay between batches to avoid rate limits
      if (i + batchSize < cardsToAnalyze.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setPsa10AnalysisRunning(false);
    toast.success(`Analysis complete! Found ${viable} PSA 10 viable cards out of ${processed} analyzed`);
    
    // Refresh cards to show updated viability data
    triggerDashboardRefresh();
  };

  if (authLoading || isInitialLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-4 xs:space-y-5 sm:space-y-6 lg:space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="text-xl xs:text-2xl sm:text-3xl font-bold mb-0.5 sm:mb-1 truncate">Dashboard</h1>
          <p className="text-sm text-muted-foreground truncate">Overview of your card collection</p>
        </div>
        <div className="flex gap-2 xs:gap-2.5 sm:gap-3 flex-wrap">
          <Button onClick={() => navigate("/scan")} className="shadow-glow flex-1 xs:flex-none text-sm" size="sm" aria-label="Scan cards">
            <Camera className="h-4 w-4 mr-1.5 xs:mr-2" aria-hidden="true" />
            <span className="xs:inline">Scan</span>
          </Button>
          <Button onClick={() => navigate("/binders")} variant="outline" size="sm" className="flex-1 xs:flex-none text-sm" aria-label="View binders">
            <BookOpen className="h-4 w-4 mr-1.5 xs:mr-2" aria-hidden="true" />
            <span className="xs:inline">Binders</span>
          </Button>
          <Button onClick={fetchDashboardData} variant="outline" size="icon-sm" disabled={isRefreshing} aria-label="Refresh dashboard" className="shrink-0">
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 xs:gap-3 sm:gap-4 lg:gap-5">
        <Card className="stat-card hover-lift">
          <CardHeader className="pb-1.5 xs:pb-2 px-3 xs:px-4 pt-3 xs:pt-4">
            <CardTitle className="text-xs xs:text-sm font-medium text-muted-foreground flex items-center gap-1.5 xs:gap-2">
              <Package className="h-3.5 w-3.5 xs:h-4 xs:w-4 shrink-0" />
              <span className="truncate">Total Cards</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 xs:px-4 pb-3 xs:pb-4">
            <div className="text-xl xs:text-2xl sm:text-3xl font-bold text-gradient-primary">{stats.totalCards.toLocaleString()}</div>
            <p className="text-2xs xs:text-xs text-muted-foreground mt-1 xs:mt-2 truncate">
              <Zap className="inline h-2.5 w-2.5 xs:h-3 xs:w-3 mr-0.5 xs:mr-1 text-primary" />
              {stats.recentScans} today
            </p>
          </CardContent>
        </Card>

        <Card className="stat-card hover-lift">
          <CardHeader className="pb-1.5 xs:pb-2 px-3 xs:px-4 pt-3 xs:pt-4">
            <CardTitle className="text-xs xs:text-sm font-medium text-muted-foreground flex items-center gap-1.5 xs:gap-2">
              <DollarSign className="h-3.5 w-3.5 xs:h-4 xs:w-4 shrink-0" />
              <span className="truncate">Total Value</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 xs:px-4 pb-3 xs:pb-4">
            <div className="text-xl xs:text-2xl sm:text-3xl font-bold truncate">${stats.totalValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
            <p className="text-2xs xs:text-xs text-muted-foreground mt-1 xs:mt-2 truncate">
              ${stats.avgCardValue.toFixed(0)} avg
            </p>
          </CardContent>
        </Card>

        <Card className="stat-card hover-lift">
          <CardHeader className="pb-1.5 xs:pb-2 px-3 xs:px-4 pt-3 xs:pt-4">
            <CardTitle className="text-xs xs:text-sm font-medium text-muted-foreground flex items-center gap-1.5 xs:gap-2">
              {stats.valueChange >= 0 ? <TrendingUp className="h-3.5 w-3.5 xs:h-4 xs:w-4 shrink-0" /> : <TrendingDown className="h-3.5 w-3.5 xs:h-4 xs:w-4 shrink-0" />}
              <span className="truncate">Trend</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 xs:px-4 pb-3 xs:pb-4">
            <div className={`text-xl xs:text-2xl sm:text-3xl font-bold ${stats.valueChange >= 0 ? "text-success" : "text-destructive"}`}>
              {stats.valueChange >= 0 ? "+" : ""}{stats.valueChange.toFixed(1)}%
            </div>
            <p className="text-2xs xs:text-xs text-muted-foreground mt-1 xs:mt-2">vs last week</p>
          </CardContent>
        </Card>

        <Card className="stat-card hover-lift">
          <CardHeader className="pb-1.5 xs:pb-2 px-3 xs:px-4 pt-3 xs:pt-4">
            <CardTitle className="text-xs xs:text-sm font-medium text-muted-foreground flex items-center gap-1.5 xs:gap-2">
              <Star className="h-3.5 w-3.5 xs:h-4 xs:w-4 shrink-0" />
              <span className="truncate">Top Rarity</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 xs:px-4 pb-3 xs:pb-4">
            <div className="text-xl xs:text-2xl sm:text-3xl font-bold truncate">{stats.topRarity}</div>
            <p className="text-2xs xs:text-xs text-muted-foreground mt-1 xs:mt-2 truncate">Most common</p>
          </CardContent>
        </Card>
      </div>

      {/* Collector Sale Value - What you could sell for today */}
      <Card className="relative overflow-hidden border-2 border-success/20 bg-gradient-to-br from-success/5 via-background to-accent/5">
        <div className="absolute top-0 right-0 w-24 xs:w-32 h-24 xs:h-32 bg-success/10 rounded-full blur-3xl -mr-12 xs:-mr-16 -mt-12 xs:-mt-16" />
        <CardHeader className="pb-2 px-3 xs:px-4 sm:px-6 pt-3 xs:pt-4 sm:pt-6">
          <CardTitle className="flex items-center gap-2 xs:gap-3">
            <div className="h-8 w-8 xs:h-10 xs:w-10 rounded-lg xs:rounded-xl bg-success/10 flex items-center justify-center shrink-0">
              <DollarSign className="h-4 w-4 xs:h-5 xs:w-5 text-success" />
            </div>
            <div className="min-w-0">
              <span className="text-sm xs:text-base sm:text-lg font-semibold block truncate">Collector Sale Value</span>
              <p className="text-2xs xs:text-xs text-muted-foreground font-normal truncate">Realistic selling price today</p>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 xs:px-4 sm:px-6 pb-3 xs:pb-4 sm:pb-6">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-4">
            <div className="min-w-0">
              <div className="text-2xl xs:text-3xl sm:text-4xl font-bold text-success truncate">
                ${stats.collectorSaleValue.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </div>
              <div className="flex flex-wrap items-center gap-2 xs:gap-3 sm:gap-4 mt-2 xs:mt-3">
                <Badge variant="secondary" className="text-2xs xs:text-xs shrink-0">
                  {stats.cardsWithPrices}/{stats.totalCards} priced
                </Badge>
                <span className="text-2xs xs:text-xs sm:text-sm text-muted-foreground">
                  ~75% market
                </span>
              </div>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => navigate("/collections")}
              className="shrink-0 w-full sm:w-auto text-sm"
            >
              View Collection
              <ArrowUpRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
          <div className="mt-3 xs:mt-4 p-2 xs:p-3 rounded-lg bg-muted/50 flex items-start gap-2">
            <Target className="h-3.5 w-3.5 xs:h-4 xs:w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-2xs xs:text-xs text-muted-foreground leading-relaxed">
              Based on collector-to-collector sales (~75% of market).
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Recent Scans */}
      <RecentScansBox />

      {/* Scan Center Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 xs:gap-4 lg:gap-5">
        <Card className="hover-lift">
          <CardHeader className="pb-2 xs:pb-3 px-3 xs:px-4 pt-3 xs:pt-4">
            <CardTitle className="flex items-center gap-2 text-sm xs:text-base">
              <div className="h-7 w-7 xs:h-8 xs:w-8 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
                <ScanIcon className="h-3.5 w-3.5 xs:h-4 xs:w-4 text-success" />
              </div>
              <span className="truncate">Quick Scan</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 xs:space-y-3 px-3 xs:px-4 pb-3 xs:pb-4">
            <p className="text-xs xs:text-sm text-muted-foreground leading-relaxed line-clamp-2">
              Open scan lab for single card AI analysis.
            </p>
            <Button size="sm" onClick={() => navigate("/scan")} className="w-full text-sm">
              <Camera className="h-4 w-4 mr-1.5 xs:mr-2" />
              Scan Lab
            </Button>
          </CardContent>
        </Card>

        <Card className="hover-lift">
          <CardHeader className="pb-2 xs:pb-3 px-3 xs:px-4 pt-3 xs:pt-4">
            <CardTitle className="flex items-center gap-2 text-sm xs:text-base">
              <div className="h-7 w-7 xs:h-8 xs:w-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                <Activity className="h-3.5 w-3.5 xs:h-4 xs:w-4 text-accent" />
              </div>
              <span className="truncate">Bulk Scan</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 xs:space-y-3 px-3 xs:px-4 pb-3 xs:pb-4">
            <p className="text-xs xs:text-sm text-muted-foreground leading-relaxed line-clamp-2">
              Batch upload multiple card images.
            </p>
            <Input
              type="file"
              accept="image/*"
              multiple
              disabled={bulkUploading}
              onChange={handleBulkFilesChange}
              className="text-xs xs:text-sm"
            />
            {(bulkUploading || bulkProgress > 0) && (
              <div className="space-y-1.5">
                <Progress value={bulkProgress} className="h-1.5 xs:h-2" />
                <p className="text-2xs xs:text-xs text-muted-foreground">{bulkProgress}%</p>
              </div>
            )}
            {bulkError && <p className="text-2xs xs:text-xs text-destructive truncate">{bulkError}</p>}
            {bulkItems.length > 0 && (
              <div className="max-h-20 xs:max-h-24 overflow-auto rounded-lg bg-secondary/50 p-2 xs:p-3 space-y-1">
                {bulkItems.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-2xs xs:text-xs">
                    <span className="truncate max-w-[60%] text-muted-foreground">{item.imageUrl || `Item ${idx + 1}`}</span>
                    <span
                      className={
                        item.status === "success"
                          ? "text-success font-medium"
                          : item.status === "error"
                            ? "text-destructive font-medium"
                            : "text-muted-foreground"
                      }
                    >
                      {item.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* PSA 10 Viability Analysis Card */}
      <Card className="relative overflow-hidden border-2 border-amber-500/20 bg-gradient-to-br from-amber-500/5 via-background to-primary/5">
        <div className="absolute top-0 right-0 w-20 xs:w-24 sm:w-32 h-20 xs:h-24 sm:h-32 bg-amber-500/10 rounded-full blur-3xl -mr-10 xs:-mr-12 sm:-mr-16 -mt-10 xs:-mt-12 sm:-mt-16" />
        <CardHeader className="pb-2 px-3 xs:px-4 sm:px-6 pt-3 xs:pt-4 sm:pt-6">
          <CardTitle className="flex items-center gap-2 xs:gap-3">
            <div className="h-8 w-8 xs:h-9 xs:w-9 sm:h-10 sm:w-10 rounded-lg xs:rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
              <Gem className="h-4 w-4 xs:h-4.5 xs:w-4.5 sm:h-5 sm:w-5 text-amber-500" />
            </div>
            <div className="min-w-0">
              <span className="text-sm xs:text-base sm:text-lg font-semibold block truncate">PSA 10 Viability Scanner</span>
              <p className="text-2xs xs:text-xs text-muted-foreground font-normal truncate">AI finds gem mint candidates</p>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 xs:px-4 sm:px-6 pb-3 xs:pb-4 sm:pb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="space-y-2 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 xs:gap-2">
                <Badge variant="secondary" className="text-2xs xs:text-xs">
                  {allCards.filter(c => c.psa10_viable === true).length} viable
                </Badge>
                <Badge variant="outline" className="text-2xs xs:text-xs">
                  {allCards.filter(c => c.psa10_viable === null && c.image_url && !c.image_url.includes('placeholder')).length} pending
                </Badge>
              </div>
              <p className="text-2xs xs:text-xs text-muted-foreground line-clamp-2">
                Scans for centering, corners, edges & surface
              </p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/collections?psa10viable=true")}
                disabled={allCards.filter(c => c.psa10_viable === true).length === 0}
                className="flex-1 sm:flex-none text-xs xs:text-sm"
              >
                <span className="truncate">View Viable</span>
              </Button>
              <Button
                size="sm"
                onClick={handlePsa10Analysis}
                disabled={psa10AnalysisRunning || allCards.filter(c => c.psa10_viable === null && c.image_url).length === 0}
                className="bg-amber-500 hover:bg-amber-600 text-white flex-1 sm:flex-none text-xs xs:text-sm"
              >
                {psa10AnalysisRunning ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 xs:h-4 xs:w-4 mr-1.5 animate-spin" />
                    <span className="truncate">Analyzing</span>
                  </>
                ) : (
                  <>
                    <Gem className="h-3.5 w-3.5 xs:h-4 xs:w-4 mr-1.5" />
                    <span className="truncate">Analyze</span>
                  </>
                )}
              </Button>
            </div>
          </div>
          {psa10AnalysisRunning && (
            <div className="mt-3 xs:mt-4 space-y-1.5">
              <Progress value={(psa10AnalysisProgress.processed / psa10AnalysisProgress.total) * 100} className="h-1.5 xs:h-2" />
              <p className="text-2xs xs:text-xs text-muted-foreground">
                {psa10AnalysisProgress.processed}/{psa10AnalysisProgress.total} • {psa10AnalysisProgress.viable} viable
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Value Over Time Chart */}
      <Card className="hover-lift">
        <CardHeader className="px-3 xs:px-4 sm:px-6 pt-3 xs:pt-4 sm:pt-6 pb-2">
          <CardTitle className="text-sm xs:text-base">Value Over Time</CardTitle>
          {scannerActive && (
            <p className="text-2xs xs:text-xs text-muted-foreground">Charts paused while scanning...</p>
          )}
        </CardHeader>
        <CardContent className="px-2 xs:px-3 sm:px-6 pb-3 xs:pb-4 sm:pb-6">
          {scannerActive ? (
            <div className="flex items-center justify-center h-40 xs:h-48 sm:h-64 text-muted-foreground text-sm">
              <Activity className="h-5 w-5 xs:h-6 xs:w-6 animate-pulse mr-2" />
              Scanner active - paused
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={window.innerWidth < 475 ? 160 : window.innerWidth < 640 ? 200 : 260}>
              <LineChart data={valueOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} width={40} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    boxShadow: "var(--shadow-lg)",
                    fontSize: "12px",
                  }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                />
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  stroke="hsl(173, 80%, 50%)" 
                  strokeWidth={2}
                  dot={{ fill: "hsl(173, 80%, 50%)", strokeWidth: 0, r: 3 }}
                  activeDot={{ r: 5, fill: "hsl(173, 80%, 50%)", stroke: "hsl(var(--background))", strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* AI Collection Advisor */}
      <Card className="hover-lift border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
        <CardHeader className="px-3 xs:px-4 sm:px-6 pt-3 xs:pt-4 sm:pt-6 pb-2">
          <CardTitle className="text-sm xs:text-base flex flex-col xs:flex-row xs:items-center xs:justify-between gap-2 xs:gap-3">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 xs:h-8 xs:w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Sparkles className="h-3.5 w-3.5 xs:h-4 xs:w-4 text-primary" />
              </div>
              <span className="truncate">AI Collection Advisor</span>
            </div>
            <Button 
              size="sm" 
              onClick={getAIAdvice} 
              disabled={aiAdviceLoading || allCards.length === 0}
              className="gap-1.5 xs:gap-2 w-full xs:w-auto text-xs xs:text-sm"
            >
              {aiAdviceLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 xs:h-4 xs:w-4 animate-spin" />
                  <span className="truncate">Analyzing...</span>
                </>
              ) : (
                <>
                  <Target className="h-3.5 w-3.5 xs:h-4 xs:w-4" />
                  <span className="truncate">Get AI Insights</span>
                </>
              )}
            </Button>
          </CardTitle>
          <p className="text-2xs xs:text-xs sm:text-sm text-muted-foreground">
            AI-powered recommendations to increase your collection's value
          </p>
        </CardHeader>
        <CardContent className="px-3 xs:px-4 sm:px-6 pb-3 xs:pb-4 sm:pb-6">
          {aiAdvice ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <div className="bg-secondary/50 rounded-lg p-3 xs:p-4 space-y-2 xs:space-y-3 text-xs xs:text-sm whitespace-pre-wrap">
                {aiAdvice}
              </div>
            </div>
          ) : (
            <div className="text-center py-4 xs:py-6 text-muted-foreground">
              <Sparkles className="h-8 w-8 xs:h-10 xs:w-10 mx-auto mb-2 xs:mb-3 opacity-30" />
              <p className="text-xs xs:text-sm">Click "Get AI Insights" for personalized recommendations</p>
              <p className="text-2xs xs:text-xs mt-1">Analyzing your {stats.totalCards} cards</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bottom Row - Top Cards and Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 xs:gap-4 lg:gap-5">
        <Card className="hover-lift">
          <CardHeader className="pb-2 px-3 xs:px-4 sm:px-6 pt-3 xs:pt-4 sm:pt-6">
            <CardTitle className="text-sm xs:text-base flex items-center justify-between">
              <div className="flex items-center gap-1.5 xs:gap-2">
                <DollarSign className="h-3.5 w-3.5 xs:h-4 xs:w-4 text-success shrink-0" />
                <span className="truncate">Top Cards</span>
              </div>
              <Badge variant="secondary" className="text-2xs xs:text-xs shrink-0">{topCards.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {topCards.length === 0 ? (
              <div className="text-center py-6 xs:py-8 text-muted-foreground px-4 xs:px-6">
                <Package className="h-8 w-8 xs:h-10 xs:w-10 mx-auto mb-2 xs:mb-3 opacity-30" />
                <p className="text-xs xs:text-sm">No cards yet. Start scanning!</p>
              </div>
            ) : (
              <ScrollArea className="h-64 xs:h-80 sm:h-96">
                <div className="space-y-1 px-3 xs:px-4 sm:px-6 pb-3 xs:pb-4 sm:pb-6">
                  {topCards.map((card, idx) => (
                    <button
                      key={card.id}
                      className="flex items-center gap-2 xs:gap-3 p-2 xs:p-2.5 rounded-lg bg-secondary/40 hover:bg-secondary/70 w-full text-left transition-all group"
                      onClick={() => {
                        setSelectedCard({
                          id: card.id,
                          card_name: card.card_name,
                          card_set: card.card_set,
                          card_number: card.card_number,
                          rarity: card.rarity,
                          image_url: card.image_url,
                          thumbnail_url: card.thumbnail_url,
                          current_price_raw: card.current_price_raw,
                          collection_name: card.collection_name,
                          condition: card.condition,
                          game_type: card.game_type,
                          sport_type: card.sport_type,
                        });
                        setShowCardDetail(true);
                      }}
                    >
                      <div className="relative flex-shrink-0">
                        <img
                          src={card.thumbnail_url || card.image_url}
                          alt={card.card_name}
                          className="w-8 h-8 xs:w-10 xs:h-10 object-cover rounded-md border border-border/50"
                        />
                        <span className="absolute -top-1 -left-1 h-3.5 w-3.5 xs:h-4 xs:w-4 rounded-full bg-primary text-primary-foreground text-[8px] xs:text-[10px] font-bold flex items-center justify-center">
                          {idx + 1}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-xs xs:text-sm truncate group-hover:text-primary transition-colors">{card.card_name}</p>
                        <p className="text-2xs xs:text-xs text-muted-foreground truncate">{card.card_set}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-success text-xs xs:text-sm">${(card.current_price_raw || 0).toFixed(2)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

        <Card className="hover-lift">
          <CardHeader className="pb-2 px-3 xs:px-4 sm:px-6 pt-3 xs:pt-4 sm:pt-6">
            <CardTitle className="text-sm xs:text-base flex items-center justify-between">
              <div className="flex items-center gap-1.5 xs:gap-2">
                <Activity className="h-3.5 w-3.5 xs:h-4 xs:w-4 text-primary shrink-0" />
                <span className="truncate">Recent Activity</span>
              </div>
              <Badge variant="secondary" className="text-2xs xs:text-xs shrink-0">{recentCards.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentCards.length === 0 ? (
              <div className="text-center py-6 xs:py-8 text-muted-foreground px-4 xs:px-6">
                <Activity className="h-8 w-8 xs:h-10 xs:w-10 mx-auto mb-2 xs:mb-3 opacity-30" />
                <p className="text-xs xs:text-sm">No recent activity</p>
              </div>
            ) : (
              <ScrollArea className="h-64 xs:h-80 sm:h-96">
                <div className="space-y-1 px-3 xs:px-4 sm:px-6 pb-3 xs:pb-4 sm:pb-6">
                  {recentCards.map((card) => (
                    <button
                      key={card.id}
                      className="flex items-center gap-2 xs:gap-3 p-2 xs:p-2.5 rounded-lg bg-secondary/40 hover:bg-secondary/70 w-full text-left transition-all group"
                      onClick={() => {
                        setSelectedCard({
                          id: card.id,
                          card_name: card.card_name,
                          card_set: card.card_set,
                          card_number: card.card_number,
                          rarity: card.rarity,
                          image_url: card.image_url,
                          thumbnail_url: card.thumbnail_url,
                          current_price_raw: card.current_price_raw,
                          collection_name: card.collection_name,
                          condition: card.condition,
                          game_type: card.game_type,
                          sport_type: card.sport_type,
                        });
                        setShowCardDetail(true);
                      }}
                    >
                      <img
                        src={card.thumbnail_url || card.image_url}
                        alt={card.card_name}
                        className="w-8 h-8 xs:w-10 xs:h-10 object-cover rounded-md border border-border/50 flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-xs xs:text-sm truncate group-hover:text-primary transition-colors">{card.card_name}</p>
                        <p className="text-2xs xs:text-xs text-muted-foreground">{new Date(card.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-medium text-xs xs:text-sm">${(card.current_price_raw || 0).toFixed(2)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Card Detail Modal */}
      <CardDetailModal
        card={selectedCard}
        open={showCardDetail}
        onOpenChange={setShowCardDetail}
        onUpdate={(updatedCard) => {
          setTopCards(topCards.map(c => c.id === updatedCard.id ? { ...c, ...updatedCard } : c));
          setRecentCards(recentCards.map(c => c.id === updatedCard.id ? { ...c, ...updatedCard } : c));
          setSelectedCard(updatedCard);
        }}
        onDelete={(cardId) => {
          setTopCards(topCards.filter(c => c.id !== cardId));
          setRecentCards(recentCards.filter(c => c.id !== cardId));
          fetchDashboardData();
        }}
      />
    </div>
  );
}
