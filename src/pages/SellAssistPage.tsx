import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Copy, Loader2, Sparkles } from "lucide-react";
import type { CardData } from "@/components/cards/CardDetailModal";

type PricingOption = {
  price: number;
  eta: string;
};

type SellAssistResult = {
  platform: string;
  reason: string;
  sellMethod: string;
  timing: string;
  pricing: {
    fast: PricingOption;
    market: PricingOption;
    max: PricingOption;
  };
  listing: {
    title: string;
    description: string;
  };
  note: string;
};

function formatMoney(n: number | null | undefined, currency = "USD") {
  if (typeof n !== "number" || Number.isNaN(n)) return "–";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  } catch {
    toast.error("Copy failed");
  }
}

export default function SellAssistPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const stateCard = (location.state as any)?.card as CardData | undefined;
  const cardId = params.get("cardId") ?? stateCard?.id ?? null;

  const [card, setCard] = useState<CardData | null>(stateCard ?? null);
  const [loadingCard, setLoadingCard] = useState<boolean>(!stateCard);

  const [goal, setGoal] = useState<"fast" | "max">("max");
  const [condition, setCondition] = useState<"raw" | "graded">("raw");
  const [risk, setRisk] = useState<"low" | "medium" | "high">("medium");

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SellAssistResult | null>(null);

  const cardSummary = useMemo(() => {
    if (!card) return "";
    const parts = [card.card_name, card.card_set, card.card_number].filter(Boolean);
    return parts.join(" • ");
  }, [card]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!cardId || stateCard) {
        setLoadingCard(false);
        return;
      }
      try {
        setLoadingCard(true);
        const { data, error } = await supabase
          .from("cards")
          .select("*")
          .eq("id", cardId)
          .single();
        if (error) throw error;
        if (!cancelled) setCard(data as any);
      } catch (e) {
        console.error(e);
        toast.error("Could not load card");
      } finally {
        if (!cancelled) setLoadingCard(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [cardId, stateCard]);

  const runAssist = async () => {
    if (!card) {
      toast.error("No card selected");
      return;
    }

    try {
      setRunning(true);
      setResult(null);

      const payload = {
        goal,
        condition,
        risk,
        card: {
          id: card.id,
          name: card.card_name,
          set: card.card_set,
          number: card.card_number,
          rarity: card.rarity,
          game: card.game_type ?? card.sport_type,
          current_price_raw: card.current_price_raw,
          psa10_price: card.psa10_price ?? null,
          cgc10_price: card.cgc10_price ?? null,
          condition_label: card.condition,
        },
      };

      const { data, error } = await supabase.functions.invoke("sell-assist", {
        body: payload,
      });

      if (error) throw error;
      if (!data) throw new Error("No response");

      setResult(data as SellAssistResult);
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Sell Assist failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)} aria-label="Go back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Sell Assist</h1>
              <Badge variant="secondary" className="gap-1">
                <Sparkles className="h-3.5 w-3.5" />
                AI
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              Listing strategy + platform recommendation + ready-to-post copy.
            </p>
          </div>
        </div>

        <Button onClick={runAssist} disabled={running || loadingCard || !card} className="gap-2">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {running ? "Analyzing…" : "Generate Sell Plan"}
        </Button>
      </div>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-base">Card</CardTitle>
          <CardDescription>
            {loadingCard ? "Loading…" : card ? cardSummary : "Open a card and tap Sell Assist."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingCard ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          ) : card ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label>Goal</Label>
                <Select value={goal} onValueChange={(v: any) => setGoal(v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fast">Fast Money</SelectItem>
                    <SelectItem value="max">Max Profit</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Condition</Label>
                <Select value={condition} onValueChange={(v: any) => setCondition(v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="raw">Raw</SelectItem>
                    <SelectItem value="graded">Graded</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Risk</Label>
                <Select value={risk} onValueChange={(v: any) => setRisk(v)}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}

          {card && (
            <div className="grid gap-3 sm:grid-cols-3 text-sm">
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground">Raw Price</div>
                <div className="font-semibold">{formatMoney(card.current_price_raw)}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground">PSA 10</div>
                <div className="font-semibold">{formatMoney(card.psa10_price)}</div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="text-muted-foreground">Condition</div>
                <div className="font-semibold">{card.condition || "–"}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="glass">
        <CardHeader>
          <CardTitle className="text-base">Sell Plan</CardTitle>
          <CardDescription>Actionable recommendations you can post immediately.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {running && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing demand, fees, and comps…
            </div>
          )}

          {!running && !result && (
            <div className="text-sm text-muted-foreground">
              Tap <span className="font-medium text-foreground">Generate Sell Plan</span> to get platform + pricing + listing copy.
            </div>
          )}

          {result && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border p-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Best Platform</div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="text-lg font-semibold">{result.platform}</div>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">{result.reason}</div>
                </div>

                <div className="rounded-xl border p-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">How to Sell</div>
                  <div className="mt-1 text-lg font-semibold">{result.sellMethod}</div>
                  <div className="mt-2 text-sm text-muted-foreground">{result.timing}</div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Pricing</h3>
                  <span className="text-xs text-muted-foreground">Pick your vibe</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border p-4">
                    <div className="text-sm font-semibold">⚡ Fast Cash</div>
                    <div className="mt-2 text-lg font-bold">{formatMoney(result.pricing.fast.price)}</div>
                    <div className="text-xs text-muted-foreground">ETA: {result.pricing.fast.eta}</div>
                  </div>
                  <div className="rounded-xl border p-4">
                    <div className="text-sm font-semibold">📊 Market</div>
                    <div className="mt-2 text-lg font-bold">{formatMoney(result.pricing.market.price)}</div>
                    <div className="text-xs text-muted-foreground">ETA: {result.pricing.market.eta}</div>
                  </div>
                  <div className="rounded-xl border p-4">
                    <div className="text-sm font-semibold">💎 Max Value</div>
                    <div className="mt-2 text-lg font-bold">{formatMoney(result.pricing.max.price)}</div>
                    <div className="text-xs text-muted-foreground">ETA: {result.pricing.max.eta}</div>
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">Listing Title</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => copyToClipboard(result.listing.title)}
                  >
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                </div>
                <div className="rounded-xl border p-4 text-sm leading-relaxed">{result.listing.title}</div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">Listing Description</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => copyToClipboard(result.listing.description)}
                  >
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                </div>
                <div className="rounded-xl border p-4 text-sm leading-relaxed whitespace-pre-wrap">{result.listing.description}</div>
              </div>

              {result.note && (
                <div className="rounded-xl border p-4 bg-muted/40">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">Strategy Note</div>
                  <div className="mt-2 text-sm">{result.note}</div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
