import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database } from "@/integrations/supabase/types";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Package,
  Activity,
  Star,
  RefreshCw,
  Scan as ScanIcon,
  BookOpen,
  Camera,
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

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    setIsRefreshing(true);
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) {
      setIsRefreshing(false);
      return;
    }

    const { data: cards } = await supabase
      .from("cards")
      .select("*")
      .eq("user_id", session.session.user.id)
      .order("created_at", { ascending: false });

    if (cards) {
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
    setIsRefreshing(false);
  };

  const COLORS = ["#8b5cf6", "#ec4899", "#10b981", "#f59e0b", "#3b82f6", "#6366f1"];

  // ----- SCAN HANDLERS -----

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

      // Hook this into your binder pipeline when ready:
      // await fetch("/functions/v1/processBinderUpload", { ... })
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

          // Full analysis (Vision + Gemini)
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your card collection</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => navigate("/scan")} variant="default">
            <Camera className="h-4 w-4 mr-2" />
            Scan Cards
          </Button>
          <Button onClick={() => navigate("/binders")} variant="outline">
            <BookOpen className="h-4 w-4 mr-2" />
            Binders
          </Button>
          <Button onClick={fetchDashboardData} variant="outline" size="icon" disabled={isRefreshing}>
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="bg-neutral-900 border-neutral-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-400">Total Cards</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.totalCards}</div>
            <p className="text-xs text-neutral-500 mt-1">
              <Package className="inline h-3 w-3 mr-1" />
              {stats.recentScans} scanned today
            </p>
          </CardContent>
        </Card>

        <Card className="bg-neutral-900 border-neutral-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-400">Total Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">${stats.totalValue.toFixed(2)}</div>
            <p className="text-xs text-neutral-500 mt-1">
              <DollarSign className="inline h-3 w-3 mr-1" />${stats.avgCardValue.toFixed(2)} avg per card
            </p>
          </CardContent>
        </Card>

        <Card className="bg-neutral-900 border-neutral-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-400">Value Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold flex items-center gap-2">
              {stats.valueChange >= 0 ? (
                <>
                  <TrendingUp className="h-6 w-6 text-green-500" />
                  <span className="text-green-500">+{stats.valueChange.toFixed(1)}%</span>
                </>
              ) : (
                <>
                  <TrendingDown className="h-6 w-6 text-red-500" />
                  <span className="text-red-500">{stats.valueChange.toFixed(1)}%</span>
                </>
              )}
            </div>
            <p className="text-xs text-neutral-500 mt-1">vs last week</p>
          </CardContent>
        </Card>

        <Card className="bg-neutral-900 border-neutral-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-neutral-400">Top Rarity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.topRarity}</div>
            <p className="text-xs text-neutral-500 mt-1">
              <Star className="inline h-3 w-3 mr-1" />
              Most common in collection
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 🔍 Scan Center Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick single scan */}
        <Card className="bg-neutral-900 border-neutral-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <ScanIcon className="h-4 w-4 text-emerald-400" />
              Quick Single Scan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-neutral-300">
            <p>Open the dedicated scan lab to drag in a single card and run full AI analysis (OCR + condition).</p>
            <Button size="sm" className="mt-2" onClick={() => navigate("/scan")}>
              <Camera className="h-4 w-4 mr-2" />
              Open Scan Lab
            </Button>
          </CardContent>
        </Card>

        {/* Binder page scan */}
        <Card className="bg-neutral-900 border-neutral-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <BookOpen className="h-4 w-4 text-sky-400" />
              Binder Page Scan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-neutral-300">
            <p>
              Upload a full 9-pocket binder page. The image is stored in
              <code className="ml-1">card-images/binder/</code> and ready for your multi-card OCR pipeline.
            </p>
            <Input
              type="file"
              accept="image/*"
              disabled={binderUploading}
              onChange={handleBinderFileChange}
              className="mt-1 text-xs"
            />
            {binderUploading && <p className="text-[11px] text-emerald-400 mt-1">Uploading binder page…</p>}
            {binderError && <p className="text-[11px] text-red-400 mt-1">{binderError}</p>}
          </CardContent>
        </Card>

        {/* Bulk scan */}
        <Card className="bg-neutral-900 border-neutral-800">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4 text-amber-400" />
              Bulk Scan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-neutral-300">
            <p>
              Select multiple card images to batch upload to
              <code className="ml-1">card-images/bulk/</code> and run full analysis on each (Vision + Gemini).
            </p>
            <Input
              type="file"
              accept="image/*"
              multiple
              disabled={bulkUploading}
              onChange={handleBulkFilesChange}
              className="mt-1 text-xs"
            />
            {(bulkUploading || bulkProgress > 0) && (
              <div className="mt-2 space-y-1">
                <Progress value={bulkProgress} className="h-2" />
                <p className="text-[11px] text-neutral-400">{bulkProgress}% complete</p>
              </div>
            )}
            {bulkError && <p className="text-[11px] text-red-400 mt-1">{bulkError}</p>}
            {bulkItems.length > 0 && (
              <div className="mt-2 max-h-24 overflow-auto rounded bg-neutral-800/60 p-2 space-y-1">
                {bulkItems.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between text-[11px]">
                    <span className="truncate max-w-[60%]">{item.imageUrl || `Item ${idx + 1}`}</span>
                    <span
                      className={
                        item.status === "success"
                          ? "text-emerald-400"
                          : item.status === "error"
                            ? "text-red-400"
                            : "text-neutral-400"
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-neutral-900 border-neutral-800">
          <CardHeader>
            <CardTitle>Value Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={valueOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="#404040" />
                <XAxis dataKey="name" stroke="#888" fontSize={12} />
                <YAxis stroke="#888" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#171717",
                    border: "1px solid #404040",
                  }}
                  labelStyle={{ color: "#fff" }}
                />
                <Line type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-neutral-900 border-neutral-800">
          <CardHeader>
            <CardTitle>Rarity Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={rarityData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {rarityData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#171717",
                    border: "1px solid #404040",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-neutral-900 border-neutral-800">
          <CardHeader>
            <CardTitle>Top Valuable Cards</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topCards.map((card, idx) => (
                <div key={card.id} className="flex items-center gap-3 p-2 rounded bg-neutral-800/50">
                  <img
                    src={card.thumbnail_url || card.image_url}
                    alt={card.card_name}
                    className="w-12 h-12 object-cover rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{card.card_name}</p>
                    <p className="text-xs text-neutral-400">{card.card_set}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-500">${(card.current_price_raw || 0).toFixed(2)}</p>
                    <p className="text-xs text-neutral-500">#{idx + 1}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-neutral-900 border-neutral-800">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentCards.map((card) => (
                <div key={card.id} className="flex items-center gap-3 p-2 rounded bg-neutral-800/50">
                  <img
                    src={card.thumbnail_url || card.image_url}
                    alt={card.card_name}
                    className="w-12 h-12 object-cover rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{card.card_name}</p>
                    <p className="text-xs text-neutral-400">{new Date(card.created_at).toLocaleDateString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">${(card.current_price_raw || 0).toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
