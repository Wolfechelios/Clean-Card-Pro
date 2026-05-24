import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, DollarSign, Download, Pause, Play, X } from "lucide-react";
import { useState } from "react";
import { useBulkJob } from "@/hooks/use-bulk-job";

interface CardRow {
  id: string;
  card_name: string;
  game_type: string | null;
  set_name: string | null;
  card_number: string | null;
  current_price_raw: number | null;
  last_price_update: string | null;
}

interface EnrichResult {
  id: string;
  card_name: string;
  before: number | null;
  game_type?: string | null;
  status: "updated" | "no_match" | "error" | "skipped";
  market?: number | null;
  set_name?: string | null;
  card_number?: string | null;
  delta?: number;
  error?: string;
}

const GAME_OPTIONS = [
  { id: "yugioh", label: "Yu-Gi-Oh", variants: ["yugioh", "Yu-Gi-Oh", "YuGiOh", "yu-gi-oh"] },
  { id: "mtg", label: "MTG", variants: ["mtg", "MTG", "magic", "Magic"] },
  { id: "pokemon", label: "Pokémon", variants: ["pokemon", "Pokemon", "Pokémon", "pokémon"] },
  { id: "unknown", label: "No game set", variants: [] },
] as const;

type GameId = typeof GAME_OPTIONS[number]["id"];

export default function TCGPlayerEnrichTab() {
  const [filter, setFilter] = useState<"missing_value" | "missing_set" | "stale" | "all">("missing_value");
  const [games, setGames] = useState<GameId[]>(["yugioh", "mtg", "pokemon", "unknown"]);

  const toggleGame = (g: GameId) =>
    setGames((p) => (p.includes(g) ? p.filter((x) => x !== g) : [...p, g]));

  const candidatesQuery = useQuery({
    queryKey: ["tcg-enrich-candidates", filter, games.join(",")],
    staleTime: 10_000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      if (games.length === 0) return [] as CardRow[];

      const selected = GAME_OPTIONS.filter((g) => games.includes(g.id));
      const variants = selected.flatMap((g) => g.variants);
      const includeUnknown = games.includes("unknown");

      let q = supabase
        .from("cards")
        .select("id, card_name, set_name, card_number, current_price_raw, game_type, last_price_update")
        .eq("user_id", user.id)
        .limit(1000);

      const gameOrParts: string[] = [];
      if (variants.length) gameOrParts.push(`game_type.in.(${variants.map((v) => `"${v}"`).join(",")})`);
      if (includeUnknown) gameOrParts.push("game_type.is.null", "game_type.eq.");
      if (gameOrParts.length) q = q.or(gameOrParts.join(","));

      if (filter === "missing_value") q = q.is("current_price_raw", null);
      if (filter === "missing_set") q = q.or("set_name.is.null,set_name.eq.,card_number.is.null,card_number.eq.");
      if (filter === "stale") {
        const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
        q = q.or(`last_price_update.is.null,last_price_update.lt.${cutoff}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as CardRow[];
    },
  });

  const job = useBulkJob<CardRow, EnrichResult>({
    jobKey: `tcg-enrich:${games.join(",")}:${filter}`,
    batchSize: 10,
    concurrency: 3,
    throttleMs: 250,
    runBatch: async (batch) => {
      const { data, error } = await supabase.functions.invoke("bulk-enrich-tcgplayer", {
        body: { cardIds: batch.map((c) => c.id) },
      });
      if (error) {
        return batch.map((c) => ({
          id: c.id, card_name: c.card_name, before: c.current_price_raw,
          status: "error" as const, error: error.message,
        }));
      }
      return (data?.results || []).map((r: any) => {
        const src = batch.find((c) => c.id === r.id);
        const before = src?.current_price_raw ?? null;
        return {
          id: r.id,
          card_name: src?.card_name || "",
          before,
          game_type: r.game_type,
          set_name: r.set_name,
          card_number: r.card_number,
          market: r.market ?? null,
          status: r.status,
          delta: before != null && r.market != null ? r.market - Number(before) : undefined,
          error: r.error,
        };
      });
    },
  });

  const candidates = candidatesQuery.data || [];
  const updatedCount = job.state.results.filter((r) => r.status === "updated").length;
  const totalValue = job.state.results.reduce((s, r) => s + (r.market || 0), 0);

  const downloadCsv = () => {
    const rows = [["Card", "Game", "Set", "#", "Before", "After", "Δ", "Status"].join(",")];
    for (const r of job.state.results) {
      rows.push([
        JSON.stringify(r.card_name || ""), r.game_type || "",
        JSON.stringify(r.set_name || ""), JSON.stringify(r.card_number || ""),
        r.before ?? "", r.market ?? "", r.delta ?? "", r.status,
      ].join(","));
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `tcgplayer-enrich-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5" /> TCGPlayer Bulk Enrich</CardTitle>
        <CardDescription>Sweeps your collection (Yu-Gi-Oh, MTG, Pokémon) and pulls TCGPlayer market value, set, and number.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Games</div>
          <div className="flex flex-wrap gap-2">
            {GAME_OPTIONS.map((g) => (
              <Button key={g.id} size="sm" variant={games.includes(g.id) ? "default" : "outline"} onClick={() => toggleGame(g.id)}>{g.label}</Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Filter</div>
          <div className="flex flex-wrap gap-2">
            {([["missing_value", "Missing value"], ["missing_set", "Missing set/#"], ["stale", "Stale (>30d)"], ["all", "All"]] as const).map(([f, l]) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>{l}</Button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            {candidatesQuery.isLoading ? "Counting…" : `${candidates.length} cards match`}
          </div>
          <div className="flex gap-2">
            {!job.state.running ? (
              <>
                <Button onClick={() => job.start(candidates)} disabled={!candidates.length}>Start enrichment</Button>
                {job.state.processed > 0 && <Button variant="ghost" onClick={job.reset}>Reset</Button>}
              </>
            ) : (
              <>
                {job.state.paused
                  ? <Button size="sm" onClick={job.resume}><Play className="mr-1 h-4 w-4" /> Resume</Button>
                  : <Button size="sm" variant="outline" onClick={job.pause}><Pause className="mr-1 h-4 w-4" /> Pause</Button>}
                <Button size="sm" variant="destructive" onClick={job.cancel}><X className="mr-1 h-4 w-4" /> Stop</Button>
              </>
            )}
          </div>
        </div>

        {(job.state.running || job.state.processed > 0) && (
          <div className="space-y-1">
            <Progress value={job.state.progress} />
            <div className="text-xs text-muted-foreground">
              {job.state.processed}/{job.state.total} · {updatedCount} updated · ${totalValue.toFixed(2)} total market value
              {job.state.running && <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />}
            </div>
          </div>
        )}

        {job.state.results.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Results</div>
              <Button size="sm" variant="outline" onClick={downloadCsv}>
                <Download className="mr-2 h-4 w-4" /> CSV
              </Button>
            </div>
            <div className="max-h-96 overflow-y-auto rounded border bg-card">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/50">
                  <tr className="text-left">
                    <th className="px-2 py-1">Card</th>
                    <th className="px-2 py-1">Game</th>
                    <th className="px-2 py-1">Set</th>
                    <th className="px-2 py-1">#</th>
                    <th className="px-2 py-1 text-right">Before</th>
                    <th className="px-2 py-1 text-right">After</th>
                    <th className="px-2 py-1 text-right">Δ</th>
                    <th className="px-2 py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {job.state.results.slice(-200).reverse().map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-2 py-1">{r.card_name}</td>
                      <td className="px-2 py-1"><Badge variant="outline" className="text-xs">{r.game_type || "—"}</Badge></td>
                      <td className="px-2 py-1">{r.set_name || "—"}</td>
                      <td className="px-2 py-1">{r.card_number || "—"}</td>
                      <td className="px-2 py-1 text-right text-muted-foreground">{r.before != null ? `$${Number(r.before).toFixed(2)}` : "—"}</td>
                      <td className="px-2 py-1 text-right">{r.market != null ? `$${r.market.toFixed(2)}` : "—"}</td>
                      <td className={`px-2 py-1 text-right ${r.delta && r.delta > 0 ? "text-emerald-500" : r.delta && r.delta < 0 ? "text-rose-500" : ""}`}>
                        {r.delta != null ? `${r.delta >= 0 ? "+" : ""}$${r.delta.toFixed(2)}` : "—"}
                      </td>
                      <td className="px-2 py-1">
                        <Badge variant={r.status === "updated" ? "default" : r.status === "no_match" || r.status === "skipped" ? "secondary" : "destructive"}>
                          {r.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
