import { useEffect, useState } from "react";
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

type CardType = Database["public"]["Tables"]["cards"]["Row"];

interface DashboardStats {
  totalCards: number;
  totalValue: number;
  recentScans: number;
  avgCardValue: number;
  topRarity: string;
  valueChange: number;
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
  const [stats, setStats] = useState<DashboardStats>({
    totalCards: 0,
    totalValue: 0,
    recentScans: 0,
    avgCardValue: 0,
    topRarity: "N/A",
    valueChange: 0,
  });
  const [recentCards, setRecentCards] = useState<CardType[]>([]);
  const [rarityData, setRarityData] = useState<ChartData[]>([]);
  const [conditionData, setConditionData] = useState<ChartData[]>([]);
  const [valueOverTime, setValueOverTime] = useState<ChartData[]>([]);
  const [topCards, setTopCards] = useState<CardType[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Scan-center state
  const [binderUploading, setBinderUploading] = useState(false);
  const [binderError, setBinderError] = useState<string | null>(null);

  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkItems, setBulkItems] = useState<BulkScanResult[]>([]);
  const [bulkProgress, setBulkProgress] = useState(0);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [selectedCard, setSelectedCard] = useState<CardData | null>(null);
  const [showCardDetail, setShowCardDetail] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    
    fetchDashboardData();

    // Set up real-time subscription for card changes
    const channel = supabase
      .channel('dashboard-cards-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'cards'
        },
        (payload) => {
          console.log('Dashboard card change detected:', payload);
          fetchDashboardData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [authLoading, userId]);

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
        allCards.push(...cards);
        page++;
        hasMore = cards.length === pageSize;
      } else {
        hasMore = false;
      }
    }

    if (allCards.length > 0) {
      const cards = allCards;
      const totalValue = cards.reduce((sum, card) => sum + (card.current_price_raw || 0), 0);
      const avgValue = cards.length > 0 ? totalValue / cards.length : 0;

      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentScans = cards.filter((c) => new Date(c.created_at) > dayAgo).length;

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
        .reduce((sum, card) => sum + (card.current_price_raw || 0), 0);

      const previousValue = cards
        .filter((c) => {
          const date = new Date(c.created_at);
          return date > fourteenDaysAgo && date <= sevenDaysAgo;
        })
        .reduce((sum, card) => sum + (card.current_price_raw || 0), 0);

      const valueChange = previousValue > 0 ? ((recentValue - previousValue) / previousValue) * 100 : 0;

      setStats({
        totalCards: cards.length,
        totalValue,
        recentScans,
        avgCardValue: avgValue,
        topRarity,
        valueChange,
      });

      setRecentCards(cards.slice(0, 5));

      const sorted = [...cards].sort((a, b) => (b.current_price_raw || 0) - (a.current_price_raw || 0));
      setTopCards(sorted.slice(0, 5));

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
          dailyValues[date] = (dailyValues[date] || 0) + (card.current_price_raw || 0);
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

  const handleBinderFileChange: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setBinderError(null);
    setBinderUploading(true);

    try {
      const ext = file.name.split(".").pop() ?? "jpg";
      const filePath = `binder/${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage.from("card-images").upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
      });

      if (uploadError) throw new Error(uploadError.message);

      const { data } = supabase.storage.from("card-images").getPublicUrl(filePath);
      const publicUrl = data.publicUrl;

      console.log("Binder page uploaded:", publicUrl);
    } catch (err: any) {
      setBinderError(err?.message ?? "Binder scan failed.");
    } finally {
      setBinderUploading(false);
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

  if (authLoading || isInitialLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-1">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your card collection</p>
        </div>
        <div className="flex gap-3">
          <Button onClick={() => navigate("/scan")} className="shadow-glow" aria-label="Scan cards">
            <Camera className="h-4 w-4 mr-2" aria-hidden="true" />
            Scan Cards
          </Button>
          <Button onClick={() => navigate("/binders")} variant="outline" aria-label="View binders">
            <BookOpen className="h-4 w-4 mr-2" aria-hidden="true" />
            Binders
          </Button>
          <Button onClick={fetchDashboardData} variant="outline" size="icon" disabled={isRefreshing} aria-label="Refresh dashboard">
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <Card className="stat-card hover-lift">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4" />
              Total Cards
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-gradient-primary">{stats.totalCards.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-2">
              <Zap className="inline h-3 w-3 mr-1 text-primary" />
              {stats.recentScans} scanned today
            </p>
          </CardContent>
        </Card>

        <Card className="stat-card hover-lift">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Total Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">${stats.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <p className="text-xs text-muted-foreground mt-2">
              ${stats.avgCardValue.toFixed(2)} avg per card
            </p>
          </CardContent>
        </Card>

        <Card className="stat-card hover-lift">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              {stats.valueChange >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              Value Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${stats.valueChange >= 0 ? "text-success" : "text-destructive"}`}>
              {stats.valueChange >= 0 ? "+" : ""}{stats.valueChange.toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-2">vs last week</p>
          </CardContent>
        </Card>

        <Card className="stat-card hover-lift">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Star className="h-4 w-4" />
              Top Rarity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.topRarity}</div>
            <p className="text-xs text-muted-foreground mt-2">Most common in collection</p>
          </CardContent>
        </Card>
      </div>

      {/* Scan Center Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="hover-lift">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="h-8 w-8 rounded-lg bg-success/10 flex items-center justify-center">
                <ScanIcon className="h-4 w-4 text-success" />
              </div>
              Quick Single Scan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Open the dedicated scan lab to drag in a single card and run full AI analysis.
            </p>
            <Button size="sm" onClick={() => navigate("/scan")} className="w-full sm:w-auto">
              <Camera className="h-4 w-4 mr-2" />
              Open Scan Lab
            </Button>
          </CardContent>
        </Card>

        <Card className="hover-lift">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                <BookOpen className="h-4 w-4 text-primary" />
              </div>
              Binder Page Scan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Upload a full 9-pocket binder page for multi-card OCR processing.
            </p>
            <Input
              type="file"
              accept="image/*"
              disabled={binderUploading}
              onChange={handleBinderFileChange}
              className="text-sm"
            />
            {binderUploading && <p className="text-xs text-primary animate-pulse">Uploading binder page…</p>}
            {binderError && <p className="text-xs text-destructive">{binderError}</p>}
          </CardContent>
        </Card>

        <Card className="hover-lift">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <div className="h-8 w-8 rounded-lg bg-accent/10 flex items-center justify-center">
                <Activity className="h-4 w-4 text-accent" />
              </div>
              Bulk Scan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Select multiple card images to batch upload and run full analysis.
            </p>
            <Input
              type="file"
              accept="image/*"
              multiple
              disabled={bulkUploading}
              onChange={handleBulkFilesChange}
              className="text-sm"
            />
            {(bulkUploading || bulkProgress > 0) && (
              <div className="space-y-2">
                <Progress value={bulkProgress} className="h-2" />
                <p className="text-xs text-muted-foreground">{bulkProgress}% complete</p>
              </div>
            )}
            {bulkError && <p className="text-xs text-destructive">{bulkError}</p>}
            {bulkItems.length > 0 && (
              <div className="max-h-24 overflow-auto rounded-lg bg-secondary/50 p-3 space-y-1.5">
                {bulkItems.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
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

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="hover-lift">
          <CardHeader>
            <CardTitle className="text-base">Value Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={valueOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.5} />
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    boxShadow: "var(--shadow-lg)",
                  }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                />
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  stroke="hsl(173, 80%, 50%)" 
                  strokeWidth={2.5}
                  dot={{ fill: "hsl(173, 80%, 50%)", strokeWidth: 0, r: 4 }}
                  activeDot={{ r: 6, fill: "hsl(173, 80%, 50%)", stroke: "hsl(var(--background))", strokeWidth: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="hover-lift">
          <CardHeader>
            <CardTitle className="text-base">Rarity Distribution</CardTitle>
            <p className="text-xs text-muted-foreground">Click a segment to view cards</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={rarityData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={90}
                  innerRadius={45}
                  fill="#8884d8"
                  dataKey="value"
                  onClick={(data) => {
                    if (data && data.name) {
                      navigate(`/collections?rarity=${encodeURIComponent(data.name)}`);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {rarityData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={COLORS[index % COLORS.length]}
                      className="hover:opacity-80 transition-opacity"
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    boxShadow: "var(--shadow-lg)",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card className="hover-lift">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-success" />
              Top Valuable Cards
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topCards.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No cards yet. Start scanning!</p>
                </div>
              ) : (
                topCards.map((card, idx) => (
                  <button
                    key={card.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-secondary/40 hover:bg-secondary/70 w-full text-left transition-all group"
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
                    <div className="relative">
                      <img
                        src={card.thumbnail_url || card.image_url}
                        alt={card.card_name}
                        className="w-12 h-12 object-cover rounded-lg border border-border/50"
                      />
                      <span className="absolute -top-1 -left-1 h-5 w-5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate group-hover:text-primary transition-colors">{card.card_name}</p>
                      <p className="text-xs text-muted-foreground truncate">{card.card_set}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-success">${(card.current_price_raw || 0).toFixed(2)}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="hover-lift">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentCards.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No recent activity</p>
                </div>
              ) : (
                recentCards.map((card) => (
                  <button
                    key={card.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-secondary/40 hover:bg-secondary/70 w-full text-left transition-all group"
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
                      className="w-12 h-12 object-cover rounded-lg border border-border/50"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate group-hover:text-primary transition-colors">{card.card_name}</p>
                      <p className="text-xs text-muted-foreground">{new Date(card.created_at).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium">${(card.current_price_raw || 0).toFixed(2)}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
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
