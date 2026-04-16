import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { LineChart, Line, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { TrendingUp, TrendingDown, DollarSign, Award } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface PortfolioViewProps {
  cards: Array<{
    id: string;
    card_name: string;
    current_price_raw: number | null;
    created_at: string;
    rarity: string | null;
    card_set: string | null;
    quantity?: number | null;
  }>;
}

export default function PortfolioView({ cards }: PortfolioViewProps) {
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPriceHistory();
  }, [cards]);

  const loadPriceHistory = async () => {
    if (cards.length === 0) {
      setLoading(false);
      return;
    }

    const cardIds = cards.map(c => c.id);
    const { data, error } = await supabase
      .from("price_history")
      .select("*")
      .in("card_id", cardIds)
      .order("recorded_at", { ascending: true });

    if (!error && data) {
      // Aggregate by date
      const aggregated = data.reduce((acc: any, record) => {
        const date = new Date(record.recorded_at).toLocaleDateString();
        if (!acc[date]) {
          acc[date] = { date, total: 0, count: 0 };
        }
        acc[date].total += record.price_raw || 0;
        acc[date].count++;
        return acc;
      }, {});

      setPriceHistory(Object.values(aggregated));
    }
    setLoading(false);
  };

  // Calculate portfolio metrics
  const totalValue = cards.reduce((sum, card) => sum + (card.current_price_raw || 0) * (card.quantity || 1), 0);
  const totalCards = cards.reduce((sum, card) => sum + (card.quantity || 1), 0);
  const avgCardValue = totalCards > 0 ? totalValue / totalCards : 0;

  // Top performers
  const topCards = [...cards]
    .filter(c => c.current_price_raw)
    .sort((a, b) => (b.current_price_raw || 0) - (a.current_price_raw || 0))
    .slice(0, 5);

  // Value by rarity
  const valueByRarity = cards.reduce((acc: any, card) => {
    const rarity = card.rarity || "Unknown";
    if (!acc[rarity]) {
      acc[rarity] = 0;
    }
    acc[rarity] += (card.current_price_raw || 0) * (card.quantity || 1);
    return acc;
  }, {});

  const rarityData = Object.entries(valueByRarity).map(([name, value]) => ({
    name,
    value: value as number,
  }));

  // Value by set
  const valueBySet = cards.reduce((acc: any, card) => {
    const set = card.card_set || "Unknown";
    if (!acc[set]) {
      acc[set] = 0;
    }
    acc[set] += card.current_price_raw || 0;
    return acc;
  }, {});

  const setData = Object.entries(valueBySet)
    .map(([name, value]) => ({
      name,
      value: value as number,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Portfolio Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalValue.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">{cards.length} cards</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Card Value</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${avgCardValue.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">per card</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Top Card</CardTitle>
            <Award className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${topCards[0]?.current_price_raw?.toFixed(2) || "0.00"}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {topCards[0]?.card_name || "No cards"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <Tabs defaultValue="value" className="space-y-4">
        <TabsList>
          <TabsTrigger value="value">Value Over Time</TabsTrigger>
          <TabsTrigger value="distribution">Distribution</TabsTrigger>
          <TabsTrigger value="top">Top Performers</TabsTrigger>
        </TabsList>

        <TabsContent value="value" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Portfolio Value History</CardTitle>
              <CardDescription>Track your collection value over time</CardDescription>
            </CardHeader>
            <CardContent>
              {priceHistory.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={priceHistory}>
                    <defs>
                      <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Area type="monotone" dataKey="total" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorTotal)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                  No price history data available yet
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="distribution" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Value by Rarity</CardTitle>
                <CardDescription>Distribution of value across rarities</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
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
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top Sets by Value</CardTitle>
                <CardDescription>Most valuable card sets</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={setData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="top" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Top 5 Most Valuable Cards</CardTitle>
              <CardDescription>Your highest value cards</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {topCards.map((card, index) => (
                  <div key={card.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-4">
                      <Badge variant="secondary" className="text-lg font-bold">#{index + 1}</Badge>
                      <div>
                        <p className="font-semibold">{card.card_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {card.card_set} {card.rarity && `• ${card.rarity}`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">${card.current_price_raw?.toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}