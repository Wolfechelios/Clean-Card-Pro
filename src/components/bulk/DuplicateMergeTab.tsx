import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Copy, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useState } from "react";

interface DupGroup {
  key: string;
  card_name: string;
  set_name: string | null;
  card_number: string | null;
  finish: string | null;
  count: number;
  total_quantity: number;
  est_value: number;
  ids: string[];
}

export default function DuplicateMergeTab() {
  const qc = useQueryClient();
  const [working, setWorking] = useState<string | null>(null);

  const dupQuery = useQuery({
    queryKey: ["bulk-duplicates"],
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("bulk-find-duplicates", {});
      if (error) throw error;
      return data as { total_cards: number; duplicate_groups: number; duplicate_rows: number; groups: DupGroup[] };
    },
  });

  const mergeMutation = useMutation({
    mutationFn: async (group: DupGroup) => {
      const [keepId, ...rest] = group.ids;
      const { data: rows, error: e1 } = await supabase
        .from("cards").select("id, quantity").in("id", group.ids);
      if (e1) throw e1;
      const totalQty = (rows || []).reduce((s, r) => s + Number(r.quantity || 1), 0);
      const { error: e2 } = await supabase
        .from("cards").update({ quantity: totalQty }).eq("id", keepId);
      if (e2) throw e2;
      const { error: e3 } = await supabase.from("cards").delete().in("id", rest);
      if (e3) throw e3;
    },
    onMutate: (g) => setWorking(g.key),
    onSettled: () => setWorking(null),
    onSuccess: () => {
      toast({ title: "Merged", description: "Duplicates collapsed into one row" });
      qc.invalidateQueries({ queryKey: ["bulk-duplicates"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Copy className="h-5 w-5" /> Duplicate Merge</CardTitle>
        <CardDescription>Find duplicate cards (same name + set + number + finish) and merge them into one row with summed quantity.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {dupQuery.isLoading ? "Scanning…" :
              dupQuery.data ? `${dupQuery.data.duplicate_groups} duplicate groups · ${dupQuery.data.duplicate_rows} extra rows` : "—"}
          </div>
          <Button size="sm" onClick={() => dupQuery.refetch()} disabled={dupQuery.isFetching}>
            {dupQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Re-scan"}
          </Button>
        </div>

        {dupQuery.data?.groups?.length ? (
          <div className="max-h-[60vh] overflow-y-auto rounded border bg-card">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/50">
                <tr className="text-left">
                  <th className="px-2 py-1">Card</th>
                  <th className="px-2 py-1">Set / #</th>
                  <th className="px-2 py-1">Finish</th>
                  <th className="px-2 py-1 text-right">Rows</th>
                  <th className="px-2 py-1 text-right">Qty</th>
                  <th className="px-2 py-1 text-right">Value</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {dupQuery.data.groups.map((g) => (
                  <tr key={g.key} className="border-t">
                    <td className="px-2 py-1 font-medium">{g.card_name}</td>
                    <td className="px-2 py-1 text-muted-foreground">{g.set_name || "—"} · {g.card_number || "—"}</td>
                    <td className="px-2 py-1"><Badge variant="outline" className="text-xs">{g.finish || "normal"}</Badge></td>
                    <td className="px-2 py-1 text-right"><Badge>{g.count}</Badge></td>
                    <td className="px-2 py-1 text-right">{g.total_quantity}</td>
                    <td className="px-2 py-1 text-right">${g.est_value.toFixed(2)}</td>
                    <td className="px-2 py-1">
                      <Button
                        size="sm" variant="outline"
                        disabled={working === g.key || mergeMutation.isPending}
                        onClick={() => mergeMutation.mutate(g)}
                      >
                        {working === g.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Trash2 className="mr-1 h-3 w-3" /> Merge</>}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !dupQuery.isLoading ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No duplicates found.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
