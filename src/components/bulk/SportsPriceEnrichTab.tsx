import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Trophy, Download, Pause, Play, X } from "lucide-react";
import { useState } from "react";
import { useBulkJob } from "@/hooks/use-bulk-job";

interface CardRow {
  id: string;
  card_name: string;
  current_price_raw: number | null;
  current_price_psa10: number | null;
  last_price_update: string | null;
  game_type: string | null;
  sport_type: string | null;
}

interface Result {
  id: string;
  card_name: string;
  status: "updated" | "no_match" | "error" | "skipped";
  raw?: number | null;
  psa9?: number | null;
  psa10?: number | null;
  before_raw?: number | null;
  delta?: number;
  error?: string;
}

export default function SportsPriceEnrichTab() {
  const [filter, setFilter] = useState<"missing_value" | "stale" | "all">("missing_value");

  const candidatesQuery = useQuery({
    queryKey: ["sports-enrich-candidates", filter],
    staleTime: 10_000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      let q = supabase
        .from("cards")
        .select("id, card_name, current_price_raw, current_price_psa10, last_price_update, game_type, sport_type")
        .eq("user_id", user.id)
        .or("game_type.eq.sports,sport_type.not.is.null")
        .limit(1000);
      if (filter === "missing_value") q = q.is("current_price_raw", null).is("current_price_psa10", null);
      if (filter === "stale") {
        const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
        q = q.or(`last_price_update.is.null,last_price_update.lt.${cutoff}`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as CardRow[];
    },
  });

  const job = useBulkJob<CardRow, Result>({
    jobKey: `sports-enrich:${filter}`,
    batchSize: 5,
    concurrency: 2,
    throttleMs: 500,
    runBatch: async (batch) => {
      const { data, error } = await supabase.functions.invoke("bulk-enrich-sports-prices", {
        body: { cardIds: batch.map((c) => c.id) },
      });
      if (error) {
        return batch.map((c) => ({ id: c.id, card_name: c.card_name, status: "error" as const, error: error.message }));
      }
      return (data?.results || []).map((r: any) => {
        const src = batch.find((c) => c.id === r.id);
        const before = src?.current_price_raw ?? null;
        return {
          id: r.id, card_name: src?.card_name || "",
          raw: r.raw ?? null, psa9: r.psa9 ?? null, psa10: r.psa10 ?? null,
          before_raw: before,
          delta: before != null && r.raw != null ? r.raw - Number(before) : undefined,
          status: r.status, error: r.error,
        };
      });
    },
  });

  const candidates = candidatesQuery.data || [];
  const updatedCount = job.state.results.filter((r) => r.status === "updated").length;

  const downloadCsv = () => {
    const out = [["Card", "Before Raw", "Raw", "PSA9", "PSA10", "Δ", "Status"].join(",")];
    for (const r of job.state.results) {
      out.push([JSON.stringify(r.card_name || ""), r.before_raw ?? "", r.raw ?? "", r.psa9 ?? "", r.psa10 ?? "", r.delta ?? "", r.status].join(","));
    }
    const blob = new Blob([out.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `sports-enrich-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5" /> Sports Card Bulk Pricing</CardTitle>
        <CardDescription>Pulls Raw, PSA 9, and PSA 10 prices via SportsCardPro / CardLadder / 130point / eBay Sold.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {([["missing_value", "Missing value"], ["stale", "Stale (>30d)"], ["all", "All sports"]] as const).map(([f, l]) => (
            <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>{l}</Button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            {candidatesQuery.isLoading ? "Counting…" : `${candidates.length} sports cards match`}
          </div>
          <div className="flex gap-2">
            {!job.state.running ? (
              <>
                <Button onClick={() => job.start(candidates)} disabled={!candidates.length}>Start pricing</Button>
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
              {job.state.processed}/{job.state.total} · {updatedCount} updated
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
                    <th className="px-2 py-1 text-right">Before</th>
                    <th className="px-2 py-1 text-right">Raw</th>
                    <th className="px-2 py-1 text-right">PSA 9</th>
                    <th className="px-2 py-1 text-right">PSA 10</th>
                    <th className="px-2 py-1 text-right">Δ</th>
                    <th className="px-2 py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {job.state.results.slice(-200).reverse().map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-2 py-1">{r.card_name}</td>
                      <td className="px-2 py-1 text-right text-muted-foreground">{r.before_raw != null ? `$${Number(r.before_raw).toFixed(2)}` : "—"}</td>
                      <td className="px-2 py-1 text-right">{r.raw != null ? `$${r.raw.toFixed(2)}` : "—"}</td>
                      <td className="px-2 py-1 text-right">{r.psa9 != null ? `$${r.psa9.toFixed(2)}` : "—"}</td>
                      <td className="px-2 py-1 text-right">{r.psa10 != null ? `$${r.psa10.toFixed(2)}` : "—"}</td>
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
