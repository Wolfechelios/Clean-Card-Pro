import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Download, ImageIcon, Pause, Play, RefreshCw, Search, ShieldCheck, Square, Wrench, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { upsertCardLocal } from "@/lib/localCards";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

type Mode = "prices" | "images" | "rarity" | "reidentify";
type RunState = "idle" | "loading" | "running" | "paused" | "stopped" | "done";
type ResultStatus = "updated" | "skipped" | "failed";

type Stats = {
  total: number;
  prices: number;
  images: number;
  rarity: number;
  reidentify: number;
};

type RunResult = {
  cardId: string;
  cardName: string;
  status: ResultStatus;
  message: string;
  fields: string[];
};

const sb = supabase as any;

const DEFAULT_STATS: Stats = { total: 0, prices: 0, images: 0, rarity: 0, reidentify: 0 };
const CARD_SELECT = [
  "id",
  "card_name",
  "card_set",
  "set_name",
  "set_code",
  "card_number",
  "game_type",
  "sport_type",
  "condition",
  "rarity",
  "edition",
  "finish",
  "year",
  "manufacturer",
  "player_name",
  "team",
  "image_url",
  "thumbnail_url",
  "current_price_raw",
  "current_price_psa9",
  "current_price_psa10",
  "suggested_price",
  "last_price_update",
  "ocr_raw_text",
  "ocr_confidence",
  "normalization_confidence",
  "notes",
].join(",");

const MODES: Array<{
  mode: Mode;
  title: string;
  description: string;
  stat: keyof Stats;
  icon: typeof RefreshCw;
}> = [
  {
    mode: "prices",
    title: "Run Prices",
    stat: "prices",
    icon: RefreshCw,
    description: "Fetch missing raw, PSA 9, PSA 10, and suggested prices, then save real values into the cards table.",
  },
  {
    mode: "images",
    title: "Run Images",
    stat: "images",
    icon: ImageIcon,
    description: "Find missing or placeholder images, attach them to storage, and fall back to the direct image URL if attach fails.",
  },
  {
    mode: "rarity",
    title: "Run Rarity",
    stat: "rarity",
    icon: ShieldCheck,
    description: "Analyze cards with missing rarity using their real image URL, then save rarity and finish back onto the card.",
  },
  {
    mode: "reidentify",
    title: "Run Re-ID",
    stat: "reidentify",
    icon: Search,
    description: "Re-identify unknown or low-confidence cards with the existing enhanced-card-identify edge function.",
  },
];

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function positiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function cleanError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  const maybe = error as any;
  return maybe?.message || maybe?.error || "Unknown bulk-tool failure";
}

function hasRealImage(url: unknown) {
  const value = text(url).toLowerCase();
  if (!value) return false;
  return !["placeholder", "placehold", "missing-card", "no-image", "blank-card"].some((marker) => value.includes(marker));
}

function extractImageUrl(data: any): string | null {
  const url = data?.imageUrl || data?.image_url || data?.url || data?.result?.imageUrl || data?.result?.image_url || data?.card?.imageUrl;
  return hasRealImage(url) ? String(url) : null;
}

function extractIdentity(data: any) {
  return data?.cardData?.primary || data?.cardData || data?.primary || data?.card || data;
}

function applyFilter(query: any, mode: Mode | "all") {
  if (mode === "prices") {
    return query.or("current_price_raw.is.null,current_price_raw.eq.0,suggested_price.is.null,suggested_price.eq.0,current_price_psa10.is.null,current_price_psa10.eq.0");
  }
  if (mode === "images") {
    return query.or("image_url.is.null,image_url.eq.,image_url.ilike.%placeholder%,image_url.ilike.%placehold%,image_url.ilike.%missing-card%,image_url.ilike.%no-image%,image_url.ilike.%blank-card%");
  }
  if (mode === "rarity") {
    return query.or("rarity.is.null,rarity.eq.,rarity.eq.Unknown,rarity.eq.unknown");
  }
  if (mode === "reidentify") {
    return query.or("card_name.eq.Unknown Card,card_name.ilike.%unknown%,normalization_confidence.lt.60,ocr_confidence.lt.60");
  }
  return query;
}

async function countMode(userId: string, mode: Mode | "all") {
  let query = sb.from("cards").select("id", { count: "exact", head: true }).eq("user_id", userId);
  query = applyFilter(query, mode);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}

async function loadStats(userId: string): Promise<Stats> {
  const [total, prices, images, rarity, reidentify] = await Promise.all([
    countMode(userId, "all"),
    countMode(userId, "prices"),
    countMode(userId, "images"),
    countMode(userId, "rarity"),
    countMode(userId, "reidentify"),
  ]);
  return { total, prices, images, rarity, reidentify };
}

async function fetchTargets(userId: string, mode: Mode, maxCards: number) {
  const safeMax = Math.max(1, Math.min(Math.floor(maxCards || 1), 10000));
  const pageSize = 1000;
  const cards: any[] = [];

  for (let offset = 0; offset < safeMax; offset += pageSize) {
    const end = Math.min(offset + pageSize - 1, safeMax - 1);
    let query = sb.from("cards").select(CARD_SELECT).eq("user_id", userId);
    query = applyFilter(query, mode).order("created_at", { ascending: true }).range(offset, end);
    const { data, error } = await query;
    if (error) throw error;
    const page = data || [];
    cards.push(...page);
    if (page.length < pageSize || cards.length >= safeMax) break;
  }

  return cards.slice(0, safeMax);
}

async function updateCard(cardId: string, updates: Record<string, unknown>) {
  const { data, error } = await sb
    .from("cards")
    .update({ ...updates, updated_at: nowIso() })
    .eq("id", cardId)
    .select()
    .single();

  if (error) throw error;
  if (!data) throw new Error("Card updated but no row was returned");
  await upsertCardLocal(data);
  return data;
}

async function runPrice(card: any): Promise<RunResult> {
  const { data, error } = await supabase.functions.invoke("fetch-card-prices", {
    body: {
      cardName: card.card_name,
      cardSet: card.card_set || card.set_name,
      cardNumber: card.card_number,
      gameType: card.game_type,
      sportType: card.sport_type,
      condition: card.condition,
    },
  });
  if (error) throw error;

  const raw = positiveNumber((data as any)?.raw ?? (data as any)?.medianRaw ?? (data as any)?.tcgPlayerMarket ?? (data as any)?.suggested);
  const psa9 = positiveNumber((data as any)?.psa9 ?? (data as any)?.medianPsa9 ?? (data as any)?.ebayPsa9);
  const psa10 = positiveNumber((data as any)?.psa10 ?? (data as any)?.medianPsa10 ?? (data as any)?.ebayPsa10);
  const suggested = positiveNumber((data as any)?.suggested ?? raw ?? psa9 ?? psa10);

  if (raw === null && psa9 === null && psa10 === null && suggested === null) {
    return { cardId: card.id, cardName: card.card_name, status: "skipped", message: "No price returned", fields: [] };
  }

  const updates: Record<string, unknown> = { last_price_update: nowIso() };
  const fields = ["last_price_update"];
  if (raw !== null) { updates.current_price_raw = raw; fields.push("current_price_raw"); }
  if (psa9 !== null) { updates.current_price_psa9 = psa9; fields.push("current_price_psa9"); }
  if (psa10 !== null) { updates.current_price_psa10 = psa10; fields.push("current_price_psa10"); }
  if (suggested !== null) { updates.suggested_price = suggested; fields.push("suggested_price"); }

  await updateCard(card.id, updates);
  return { cardId: card.id, cardName: card.card_name, status: "updated", message: `Saved ${fields.length - 1} price field(s)`, fields };
}

async function runImage(card: any): Promise<RunResult> {
  const { data, error } = await supabase.functions.invoke("generate-card-image-url", {
    body: {
      cardName: card.card_name,
      cardSet: card.card_set || card.set_name,
      cardNumber: card.card_number,
      gameType: card.game_type || card.sport_type,
    },
  });
  if (error) throw error;

  const remoteImageUrl = extractImageUrl(data);
  if (!remoteImageUrl) {
    await updateCard(card.id, { image_status: "not_found", image_last_attempt_at: nowIso(), image_error: (data as any)?.error || "No valid image URL returned" });
    return { cardId: card.id, cardName: card.card_name, status: "skipped", message: "No valid image found", fields: ["image_status"] };
  }

  try {
    const { data: attachData, error: attachError } = await supabase.functions.invoke("attach-image", {
      body: { cardId: card.id, remoteImageUrl },
    });
    if (attachError) throw attachError;
    const savedUrl = extractImageUrl(attachData) || remoteImageUrl;
    await updateCard(card.id, {
      image_url: savedUrl,
      thumbnail_url: savedUrl,
      image_status: (attachData as any)?.note ? "external" : "ok",
      image_error: null,
      image_last_attempt_at: nowIso(),
      image_updated_at: nowIso(),
    });
    return { cardId: card.id, cardName: card.card_name, status: "updated", message: (attachData as any)?.note || "Image saved", fields: ["image_url", "thumbnail_url", "image_status"] };
  } catch (attachError) {
    await updateCard(card.id, {
      image_url: remoteImageUrl,
      thumbnail_url: remoteImageUrl,
      image_status: "external",
      image_error: null,
      image_last_attempt_at: nowIso(),
      image_updated_at: nowIso(),
    });
    return { cardId: card.id, cardName: card.card_name, status: "updated", message: `Stored direct image URL after attach fallback: ${cleanError(attachError)}`, fields: ["image_url", "thumbnail_url", "image_status"] };
  }
}

async function urlToBase64(imageUrl: string) {
  const response = await fetch(imageUrl, { mode: "cors" });
  if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.onloadend = () => {
      const value = String(reader.result || "");
      const base64 = value.includes(",") ? value.split(",").pop() : value;
      if (!base64) reject(new Error("Could not convert image to base64"));
      else resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}

async function runRarity(card: any): Promise<RunResult> {
  if (!hasRealImage(card.image_url)) {
    return { cardId: card.id, cardName: card.card_name, status: "skipped", message: "Rarity analysis needs a real image URL", fields: [] };
  }

  const image_base64 = await urlToBase64(card.image_url);
  const { data, error } = await supabase.functions.invoke("analyze-foil-rarity", {
    body: { image_base64, game_type: card.game_type || card.sport_type },
  });
  if (error) throw error;

  const rarity = text((data as any)?.rarity || (data as any)?.simplified_class);
  if (!rarity) {
    return { cardId: card.id, cardName: card.card_name, status: "skipped", message: (data as any)?.error || "No rarity returned", fields: [] };
  }

  const note = [
    (data as any)?.confidence !== undefined ? `confidence=${(data as any).confidence}` : null,
    (data as any)?.pattern_type ? `pattern=${(data as any).pattern_type}` : null,
    (data as any)?.reasoning ? `reasoning=${(data as any).reasoning}` : null,
  ].filter(Boolean).join("; ");

  await updateCard(card.id, {
    rarity,
    finish: (data as any)?.simplified_class || card.finish,
    notes: [card.notes, note ? `Bulk rarity: ${note}` : null].filter(Boolean).join("\n"),
  });
  return { cardId: card.id, cardName: card.card_name, status: "updated", message: `Rarity set to ${rarity}`, fields: ["rarity", "finish", "notes"] };
}

async function runReidentify(card: any): Promise<RunResult> {
  if (!hasRealImage(card.image_url)) {
    return { cardId: card.id, cardName: card.card_name, status: "skipped", message: "Re-ID needs a real image URL", fields: [] };
  }

  const { data, error } = await supabase.functions.invoke("enhanced-card-identify", {
    body: { imageUrl: card.image_url, ocrText: card.ocr_raw_text, gameTypeHint: card.game_type || card.sport_type || "auto" },
  });
  if (error) throw error;
  if ((data as any)?.success === false) throw new Error((data as any)?.error || "Enhanced ID failed");

  const identity = extractIdentity(data as any);
  if (!identity || typeof identity !== "object") {
    return { cardId: card.id, cardName: card.card_name, status: "skipped", message: "No identity returned", fields: [] };
  }

  const updates: Record<string, unknown> = {};
  const fields: string[] = [];
  const copy = (field: string, value: unknown) => {
    if (value !== null && value !== undefined && text(value) && text(value) !== text(card[field])) {
      updates[field] = value;
      fields.push(field);
    }
  };

  copy("card_name", identity.card_name);
  copy("card_set", identity.card_set || identity.set_name);
  copy("set_name", identity.card_set || identity.set_name);
  copy("card_number", identity.card_number);
  copy("rarity", identity.rarity);
  copy("edition", identity.edition);
  copy("game_type", identity.game_type);
  copy("sport_type", identity.sport_type);
  copy("manufacturer", identity.manufacturer);

  const year = positiveNumber(identity.year);
  if (year !== null && year !== card.year) { updates.year = year; fields.push("year"); }
  const confidence = positiveNumber(identity.confidence);
  if (confidence !== null) { updates.normalization_confidence = confidence; fields.push("normalization_confidence"); }

  if (fields.length === 0) {
    return { cardId: card.id, cardName: card.card_name, status: "skipped", message: "Identity already matches", fields: [] };
  }

  await updateCard(card.id, updates);
  return { cardId: card.id, cardName: card.card_name, status: "updated", message: `Updated ${fields.join(", ")}`, fields };
}

async function runOperation(mode: Mode, card: any): Promise<RunResult> {
  try {
    if (mode === "prices") return await runPrice(card);
    if (mode === "images") return await runImage(card);
    if (mode === "rarity") return await runRarity(card);
    return await runReidentify(card);
  } catch (error) {
    return { cardId: card.id, cardName: card.card_name, status: "failed", message: cleanError(error), fields: [] };
  }
}

function exportCsv(mode: string, rows: RunResult[]) {
  const header = ["cardId", "cardName", "status", "fields", "message"];
  const csv = [header, ...rows.map((row) => [row.cardId, row.cardName, row.status, row.fields.join("|"), row.message])]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `clean-card-bulk-${mode}-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function BulkToolsPage() {
  const { userId } = useAuth();
  const [stats, setStats] = useState<Stats>(DEFAULT_STATS);
  const [state, setState] = useState<RunState>("idle");
  const [activeMode, setActiveMode] = useState<Mode | null>(null);
  const [batchSize, setBatchSize] = useState(3);
  const [delayMs, setDelayMs] = useState(650);
  const [maxCards, setMaxCards] = useState(5000);
  const [targets, setTargets] = useState<any[]>([]);
  const [processed, setProcessed] = useState(0);
  const [updated, setUpdated] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [failed, setFailed] = useState(0);
  const [currentCard, setCurrentCard] = useState("");
  const [results, setResults] = useState<RunResult[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const stopRef = useRef(false);
  const pauseRef = useRef(false);

  const busy = state === "loading" || state === "running" || state === "paused";
  const progress = targets.length ? Math.round((processed / targets.length) * 100) : 0;
  const activeTitle = MODES.find((m) => m.mode === activeMode)?.title || "Bulk run";

  const eta = useMemo(() => {
    if (!startedAt || processed <= 0 || targets.length <= 0) return "calculating";
    const elapsed = (Date.now() - startedAt) / 1000;
    const rate = processed / elapsed;
    if (rate <= 0) return "calculating";
    const seconds = (targets.length - processed) / rate;
    const minutes = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
  }, [processed, startedAt, targets.length]);

  const refreshStats = async () => {
    if (!userId) return;
    try {
      setStats(await loadStats(userId));
    } catch (error: any) {
      console.error("Bulk stats failed:", error);
      toast.error(error?.message || "Could not load bulk stats");
    }
  };

  useEffect(() => {
    refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const run = async (mode: Mode) => {
    if (!userId) {
      toast.error("Log in before running bulk tools");
      return;
    }
    if (busy) {
      toast.info("A bulk job is already running. Stop it first.");
      return;
    }

    const safeBatch = Math.max(1, Math.min(Math.floor(batchSize || 1), 25));
    const safeDelay = Math.max(0, Math.min(Math.floor(delayMs || 0), 10000));
    const safeMax = Math.max(1, Math.min(Math.floor(maxCards || 1), 10000));

    stopRef.current = false;
    pauseRef.current = false;
    setActiveMode(mode);
    setState("loading");
    setTargets([]);
    setResults([]);
    setProcessed(0);
    setUpdated(0);
    setSkipped(0);
    setFailed(0);
    setCurrentCard("");

    try {
      toast.loading("Loading target cards...", { id: "bulk-tools" });
      const loaded = await fetchTargets(userId, mode, safeMax);
      setTargets(loaded);
      if (loaded.length === 0) {
        setState("done");
        toast.success("No cards matched this bulk tool", { id: "bulk-tools" });
        await refreshStats();
        return;
      }

      setStartedAt(Date.now());
      setState("running");
      toast.loading(`Running ${loaded.length.toLocaleString()} cards...`, { id: "bulk-tools" });

      let done = 0;
      let ok = 0;
      let skip = 0;
      let bad = 0;
      const log: RunResult[] = [];

      for (let i = 0; i < loaded.length; i += safeBatch) {
        if (stopRef.current) break;
        while (pauseRef.current && !stopRef.current) await wait(250);
        if (stopRef.current) break;

        const batch = loaded.slice(i, i + safeBatch);
        setCurrentCard(batch[0]?.card_name || "");
        const batchResults = await Promise.all(batch.map((card) => runOperation(mode, card)));
        log.push(...batchResults);
        done += batchResults.length;
        ok += batchResults.filter((r) => r.status === "updated").length;
        skip += batchResults.filter((r) => r.status === "skipped").length;
        bad += batchResults.filter((r) => r.status === "failed").length;
        setResults([...log]);
        setProcessed(done);
        setUpdated(ok);
        setSkipped(skip);
        setFailed(bad);
        if (i + safeBatch < loaded.length && safeDelay > 0) await wait(safeDelay);
      }

      setCurrentCard("");
      setState(stopRef.current ? "stopped" : "done");
      if (stopRef.current) {
        toast.warning(`Stopped after ${done.toLocaleString()} cards`, { id: "bulk-tools" });
      } else {
        toast.success(`Complete: ${ok} updated, ${skip} skipped, ${bad} failed`, { id: "bulk-tools" });
      }
      await refreshStats();
    } catch (error: any) {
      console.error("Bulk run failed:", error);
      setState("idle");
      toast.error(error?.message || "Bulk run failed", { id: "bulk-tools" });
    }
  };

  const pause = () => {
    pauseRef.current = true;
    setState("paused");
  };

  const resume = () => {
    pauseRef.current = false;
    setState("running");
  };

  const stop = () => {
    stopRef.current = true;
    pauseRef.current = false;
    if (busy) setState("stopped");
  };

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Wrench className="h-7 w-7 text-primary" />
            Bulk Tools
          </h1>
          <p className="text-muted-foreground">
            Working bulk repairs for prices, images, rarity, and re-identification. Writes to Supabase and mirrors successful updates locally.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={refreshStats} disabled={busy}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh Stats
          </Button>
          <Button variant="destructive" onClick={stop} disabled={!busy}>
            <Square className="h-4 w-4 mr-2" />
            Stop All Bulk Jobs
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Total Cards</p><p className="text-2xl font-bold">{stats.total.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Missing Prices</p><p className="text-2xl font-bold">{stats.prices.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Missing Images</p><p className="text-2xl font-bold">{stats.images.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Missing Rarity</p><p className="text-2xl font-bold">{stats.rarity.toLocaleString()}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Needs Re-ID</p><p className="text-2xl font-bold">{stats.reidentify.toLocaleString()}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-primary" />Run Controls</CardTitle>
          <CardDescription>Throttle these so edge functions do not get rate-limited. Galloping into a 429 is a very modern form of tripping over a cord.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Batch size</Label>
              <Input type="number" min={1} max={25} value={batchSize} onChange={(e) => setBatchSize(Number(e.target.value))} disabled={busy} />
            </div>
            <div className="space-y-2">
              <Label>Delay between batches, ms</Label>
              <Input type="number" min={0} max={10000} value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value))} disabled={busy} />
            </div>
            <div className="space-y-2">
              <Label>Max cards this run</Label>
              <Input type="number" min={1} max={10000} value={maxCards} onChange={(e) => setMaxCards(Number(e.target.value))} disabled={busy} />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {MODES.map((tool) => {
              const Icon = tool.icon;
              const count = Number(stats[tool.stat] || 0);
              const active = activeMode === tool.mode && busy;
              return (
                <Card key={tool.mode} className="bg-background">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2"><Icon className="h-4 w-4 text-primary" />{tool.title}</span>
                      <Badge variant={count ? "default" : "secondary"}>{count.toLocaleString()}</Badge>
                    </CardTitle>
                    <CardDescription className="text-xs">{tool.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button className="w-full" variant={count ? "default" : "outline"} disabled={busy || !count} onClick={() => run(tool.mode)}>
                      {active ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Icon className="h-4 w-4 mr-2" />}
                      {active ? "Running" : tool.title}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {(state !== "idle" || results.length > 0) && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Badge variant={state === "done" ? "default" : state === "stopped" ? "destructive" : "secondary"}>{state.toUpperCase()}</Badge>
                  {activeTitle}
                </CardTitle>
                <CardDescription>
                  {processed.toLocaleString()} / {targets.length.toLocaleString()} processed • {updated} updated • {skipped} skipped • {failed} failed • ETA {eta}
                </CardDescription>
                {currentCard && <p className="text-xs text-muted-foreground mt-1">Current: {currentCard}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {state === "running" && <Button variant="outline" size="sm" onClick={pause}><Pause className="h-4 w-4 mr-2" />Pause</Button>}
                {state === "paused" && <Button variant="outline" size="sm" onClick={resume}><Play className="h-4 w-4 mr-2" />Resume</Button>}
                <Button variant="outline" size="sm" disabled={!results.length} onClick={() => exportCsv(activeMode || "run", results)}><Download className="h-4 w-4 mr-2" />Export CSV</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={progress} />
            <Separator />
            <div className="max-h-80 overflow-y-auto rounded-lg border">
              {results.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">Run log will appear here.</div>
              ) : (
                <div className="divide-y">
                  {results.slice(-100).reverse().map((result, index) => (
                    <div key={`${result.cardId}-${index}`} className="grid gap-2 p-3 text-sm md:grid-cols-[140px_1fr]">
                      <div className="flex items-center gap-2">
                        {result.status === "updated" ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <AlertCircle className="h-4 w-4 text-muted-foreground" />}
                        <Badge variant={result.status === "failed" ? "destructive" : result.status === "updated" ? "default" : "secondary"}>{result.status}</Badge>
                      </div>
                      <div>
                        <p className="font-medium">{result.cardName}</p>
                        <p className="text-xs text-muted-foreground">{result.message}</p>
                        {!!result.fields.length && <p className="text-xs text-muted-foreground">Fields: {result.fields.join(", ")}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
