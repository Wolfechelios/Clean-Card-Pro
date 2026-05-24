import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, RefreshCw, Pause, Play, X } from "lucide-react";
import { useState } from "react";
import { useBulkJob } from "@/hooks/use-bulk-job";

interface CardRow {
  id: string;
  card_name: string;
  game_type: string | null;
  sport_type: string | null;
  current_price_raw: number | null;
  last_price_update: string | null;
}

interface RunResult {
  id: string;
  card_name: string;
  before: number | null;
  after: number | null;
  status: "updated" | "no_match" | "error" | "skipped";
  delta?: number;
  error?: string;
}

const STALE_DAYS_OPTIONS = [7, 30, 60, 90] as const;

export default function StalePriceRefreshTab() {
  const [days, setDays] = useState<number>(30);

  const q = useQuery({
    queryKey: ["stale-price-candidates", days],
    staleTime: 10_000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const { data, error } = await supabase
        .from("cards")
        .select("id, card_name, game_type, sport_type, current_price_raw, last_price_update")
        .eq("user_id", user.id)
        .or(`last_price_update.is.null,last_price_update.lt.${cutoff}`)
        .limit(1000);
      if (error) throw error;
      return (data || []) as CardRow[];
    },
  });

  const job = useBulkJob<CardRow, RunResult>({
    jobKey: `stale-price-refresh:${days}`,
    batchSize: 5,
    concurrency: 3,
    throttleMs: 500,
    runBatch: async (batch) => {
      // Split by sports vs tcg
      const sportsIds = batch.filter((c) => (c.game_type || "").toLowerCase() === "sports" || c.sport_type).map((c) => c.id);
      const tcgIds = batch.filter((c) => !sportsIds.includes(c.id)).map((c) => c.id);

      const out: RunResult[] = [];
      const calls: Promise<void>[] = [];

      if (tcgIds.length) {
        calls.push((async () => {
          const { data, error } = await supabase.functions.invoke("bulk-enrich-tcgplayer", { body: { cardIds: tcgIds } });
          if (error) {
            for (const id of tcgIds) {
              const src = batch.find((c) => c.id === id)!;
              out.push({ id, card_name: src.card_name, before: src.current_price_raw, after: null, status: "error", error: error.message });
            }
            return;
          }
          for (const r of data?.results || []) {
            const src = batch.find((c) => c.id === r.id);
            const before = src?.current_price_raw ?? null;
            out.push({
              id: r.id, card_name: src?.card_name || "", before,
              after: r.market ?? null, status: r.status,
              delta: before != null && r.market != null ? r.market - Number(before) : undefined,
              error: r.error,
            });
          }
        })());
      }
      if (sportsIds.length) {
        calls.push((async () => {
          const { data, error } = await supabase.functions.invoke("bulk-enrich-sports-prices", { body: { cardIds: sportsIds } });
          if (error) {
            for (const id of sportsIds) {
              const src = batch.find((c) => c.id === id)!;
              out.push({ id, card_name: src.card_name, before: src.current_price_raw, after: null, status: "error", error: error.message });
            }
            return;
          }
          for (const r of data?.results || []) {
            const src = batch.find((c) => c.id === r.id);
            const before = src?.current_price_raw ?? null;
            const after = r.raw ?? null;
            out.push({
              id: r.id, card_name: src?.card_name || "", before, after,
              status: r.status,
              delta: before != null && after != null ? after - Number(before) : undefined,
              error: r.error,
            });
          }
        })());
      }
      await Promise.all(calls);
      return out;
    },
  });

  const updated = job.state.results.filter((r) => r.status === "updated").length;
  const totalDelta = job.state.results.reduce((s, r) => s + (r.delta || 0), 0);
  const candidates = q.data || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5" /> Stale Price Refresh</CardTitle>
        <CardDescription>Refreshes any card whose price hasn't been updated within the chosen window. Routes TCG → TCGPlayer, sports → SportsCardPro.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {STALE_DAYS_OPTIONS.map((d) => (
            <Button key={d} size="sm" variant={days === d ? "default" : "outline"} onClick={() => setDays(d)}>
              {d} days
            </Button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            {q.isLoading ? "Counting…" : `${candidates.length} cards stale`}
          </div>
          <div className="flex gap-2">
            {!job.state.running ? (
              <>
                <Button onClick={() => job.start(candidates)} disabled={!candidates.length}>
                  Start refresh
                </Button>
                {job.state.processed > 0 && (
                  <Button variant="ghost" onClick={job.reset}>Reset</Button>
                )}
              </>
            ) : (
              <>
                {job.state.paused ? (
                  <Button size="sm" onClick={job.resume}><Play className="mr-1 h-4 w-4" /> Resume</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={job.pause}><Pause className="mr-1 h-4 w-4" /> Pause</Button>
                )}
                <Button size="sm" variant="destructive" onClick={job.cancel}><X className="mr-1 h-4 w-4" /> Stop</Button>
              </>
            )}
          </div>
        </div>

        {(job.state.running || job.state.processed > 0) && (
          <div className="space-y-1">
            <Progress value={job.state.progress} />
            <div className="text-xs text-muted-foreground">
              {job.state.processed}/{job.state.total} · {updated} updated · Δ ${totalDelta.toFixed(2)}
              {job.state.running && <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />}
            </div>
          </div>
        )}

        {job.state.results.length > 0 && (
          <div className="max-h-96 overflow-y-auto rounded border bg-card">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50">
                <tr className="text-left">
                  <th className="px-2 py-1">Card</th>
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
                    <td className="px-2 py-1 text-right text-muted-foreground">{r.before != null ? `$${Number(r.before).toFixed(2)}` : "—"}</td>
                    <td className="px-2 py-1 text-right">{r.after != null ? `$${r.after.toFixed(2)}` : "—"}</td>
                    <td className={`px-2 py-1 text-right ${r.delta && r.delta > 0 ? "text-emerald-500" : r.delta && r.delta < 0 ? "text-rose-500" : ""}`}>
                      {r.delta != null ? `${r.delta >= 0 ? "+" : ""}$${r.delta.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-2 py-1">
                      <Badge variant={r.status === "updated" ? "default" : r.status === "error" ? "destructive" : "secondary"}>{r.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
