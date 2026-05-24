import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, ListChecks, Download } from "lucide-react";
import { useState } from "react";

interface SetRow {
  set_name: string;
  game_type: string;
  owned: number;
  unique: number;
  total: number | null;
  completion_pct: number | null;
  value: number;
}

export default function SetCompletionTab() {
  const [filter, setFilter] = useState<"all" | "near" | "started">("all");

  const q = useQuery({
    queryKey: ["bulk-set-completion"],
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("bulk-set-completion", {});
      if (error) throw error;
      return data as { sets: SetRow[] };
    },
  });

  const rows = (q.data?.sets || []).filter((r) => {
    if (filter === "near") return (r.completion_pct ?? 0) >= 70 && (r.completion_pct ?? 0) < 100;
    if (filter === "started") return (r.completion_pct ?? 0) > 0 && (r.completion_pct ?? 0) < 100;
    return true;
  });

  const downloadCsv = () => {
    const out = [["Set", "Game", "Owned", "Unique #", "Total", "Completion %", "Value"].join(",")];
    for (const r of rows) {
      out.push([
        JSON.stringify(r.set_name), r.game_type, r.owned, r.unique,
        r.total ?? "", r.completion_pct ?? "", r.value,
      ].join(","));
    }
    const blob = new Blob([out.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `set-completion-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ListChecks className="h-5 w-5" /> Set Completion Sweep</CardTitle>
        <CardDescription>See how close you are to completing each set. Totals come from your imported reference sets.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {([["all", "All"], ["near", "Near complete (≥70%)"], ["started", "Started"]] as const).map(([k, l]) => (
            <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>{l}</Button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={downloadCsv} disabled={!rows.length}>
              <Download className="mr-2 h-4 w-4" /> CSV
            </Button>
            <Button size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
              {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Re-scan"}
            </Button>
          </div>
        </div>

        {q.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Scanning collection…
          </div>
        ) : rows.length ? (
          <div className="max-h-[60vh] overflow-y-auto rounded border bg-card">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50">
                <tr className="text-left">
                  <th className="px-2 py-1">Set</th>
                  <th className="px-2 py-1">Game</th>
                  <th className="px-2 py-1 text-right">Unique / Total</th>
                  <th className="px-2 py-1">Completion</th>
                  <th className="px-2 py-1 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.set_name} className="border-t">
                    <td className="px-2 py-1 font-medium">{r.set_name}</td>
                    <td className="px-2 py-1"><Badge variant="outline" className="text-xs">{r.game_type}</Badge></td>
                    <td className="px-2 py-1 text-right">{r.unique} / {r.total ?? "?"}</td>
                    <td className="px-2 py-1">
                      {r.completion_pct != null ? (
                        <div className="flex items-center gap-2">
                          <Progress value={r.completion_pct} className="h-2 w-24" />
                          <span className="text-xs text-muted-foreground">{r.completion_pct}%</span>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">no ref</span>}
                    </td>
                    <td className="px-2 py-1 text-right">${r.value.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No sets matched the filter.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
