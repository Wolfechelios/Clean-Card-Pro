import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useMemo, useState } from "react";

interface Candidate {
  id: string;
  card_name: string;
  card_set: string | null;
  set_name: string | null;
  year: number | null;
  current_price_raw: number | null;
  image_url: string | null;
  game_type: string | null;
  confidence: number;
  reasons: string[];
  guess: string;
}

const GAME_FILTERS = [
  { id: "all", label: "All games" },
  { id: "mtg", label: "MTG (Vintage)" },
  { id: "pokemon", label: "Pokémon (WOTC)" },
  { id: "yugioh", label: "Yu-Gi-Oh (Early)" },
  { id: "sports", label: "Sports (Pre-1990)" },
] as const;

type BulkAction = { label: string; edition: string; year?: number };

function bulkActionsFor(game: string): BulkAction[] {
  switch (game) {
    case "mtg":
      return [
        { label: "Mark all Alpha", edition: "Alpha", year: 1993 },
        { label: "Mark all Beta", edition: "Beta", year: 1993 },
        { label: "Mark all Unlimited", edition: "Unlimited", year: 1993 },
      ];
    case "pokemon":
      return [
        { label: "Mark all 1st Edition", edition: "1st Edition" },
        { label: "Mark all Shadowless", edition: "Shadowless" },
      ];
    case "yugioh":
      return [{ label: "Mark all 1st Edition", edition: "1st Edition" }];
    default:
      return [{ label: "Confirm vintage", edition: "Vintage" }];
  }
}

export default function VintageAuditTab() {
  const qc = useQueryClient();
  const [game, setGame] = useState<typeof GAME_FILTERS[number]["id"]>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const auditQuery = useQuery({
    queryKey: ["vintage-audit", game],
    staleTime: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("audit-alpha-beta", { body: { game } });
      if (error) throw error;
      return data as { totalScanned: number; candidates: Candidate[] };
    },
  });

  const candidates = auditQuery.data?.candidates ?? [];

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAll = () => setSelected(new Set(candidates.map((c) => c.id)));
  const selectHighConfidence = () =>
    setSelected(new Set(candidates.filter((c) => c.confidence >= 70).map((c) => c.id)));
  const clearSelection = () => setSelected(new Set());

  const bulkMark = useMutation({
    mutationFn: async ({ ids, edition, year }: { ids: string[]; edition: string; year?: number }) => {
      const update: { edition: string; year?: number } = { edition };
      if (year) update.year = year;
      const { error } = await supabase.from("cards").update(update).in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (count, vars) => {
      toast({ title: "Marked", description: `${count} card${count === 1 ? "" : "s"} marked as ${vars.edition}` });
      clearSelection();
      qc.invalidateQueries({ queryKey: ["vintage-audit"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const singleMark = useMutation({
    mutationFn: async ({ id, edition, year }: { id: string; edition: string; year?: number }) => {
      const update: { edition: string; year?: number } = { edition };
      if (year) update.year = year;
      const { error } = await supabase.from("cards").update(update).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Marked", description: "Card updated" });
      qc.invalidateQueries({ queryKey: ["vintage-audit"] });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const bulkActions = useMemo(() => bulkActionsFor(game), [game]);
  const selectedIds = useMemo(() => Array.from(selected), [selected]);
  const allSelected = candidates.length > 0 && selected.size === candidates.length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" /> Vintage Audit
          </CardTitle>
          <CardDescription>
            Surfaces likely vintage cards across MTG, Pokémon, Yu-Gi-Oh, and Sports.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {GAME_FILTERS.map((g) => (
              <Button
                key={g.id}
                size="sm"
                variant={game === g.id ? "default" : "outline"}
                onClick={() => {
                  setGame(g.id);
                  clearSelection();
                }}
              >
                {g.label}
              </Button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {auditQuery.isLoading
                ? "Scanning collection…"
                : auditQuery.data
                ? `Reviewed ${auditQuery.data.totalScanned} cards · ${candidates.length} candidates`
                : "—"}
            </div>
            <Button size="sm" onClick={() => auditQuery.refetch()} disabled={auditQuery.isFetching}>
              {auditQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Re-scan"}
            </Button>
          </div>

          {candidates.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2">
              <Button size="sm" variant="outline" onClick={allSelected ? clearSelection : selectAll}>
                {allSelected ? "Clear" : "Select all"}
              </Button>
              <Button size="sm" variant="outline" onClick={selectHighConfidence}>
                Select ≥70%
              </Button>
              <span className="text-sm text-muted-foreground">{selected.size} selected</span>
              <div className="ml-auto flex flex-wrap gap-2">
                {bulkActions.map((a) => (
                  <Button
                    key={a.label}
                    size="sm"
                    disabled={selected.size === 0 || bulkMark.isPending}
                    onClick={() => bulkMark.mutate({ ids: selectedIds, edition: a.edition, year: a.year })}
                  >
                    {bulkMark.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : a.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {candidates.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {candidates.map((c) => {
                const isMtg = (c.game_type || "").toLowerCase() === "mtg" || (c.game_type || "").toLowerCase() === "magic";
                const isSelected = selected.has(c.id);
                return (
                  <div
                    key={c.id}
                    className={`flex gap-3 rounded-lg border bg-card p-3 transition-colors ${
                      isSelected ? "border-primary ring-1 ring-primary" : ""
                    }`}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleOne(c.id)}
                      className="mt-1"
                    />
                    {c.image_url && (
                      <img src={c.image_url} alt="" className="h-20 w-14 rounded object-cover" />
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-sm font-semibold">{c.card_name}</div>
                        <Badge variant={c.confidence >= 70 ? "default" : "secondary"}>
                          {c.confidence}%
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px]">{c.game_type || "?"}</Badge>
                        <span>{c.set_name || c.card_set || "Unknown set"} · {c.year ?? "—"} ·{" "}
                        {c.current_price_raw != null ? `$${Number(c.current_price_raw).toFixed(2)}` : "no price"}</span>
                      </div>
                      <div className="text-xs italic text-muted-foreground">
                        {c.guess} · {c.reasons.join("; ")}
                      </div>
                      {isMtg && (
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm" variant="outline"
                            disabled={singleMark.isPending}
                            onClick={() => singleMark.mutate({ id: c.id, edition: "Alpha", year: 1993 })}
                          >Alpha</Button>
                          <Button
                            size="sm" variant="outline"
                            disabled={singleMark.isPending}
                            onClick={() => singleMark.mutate({ id: c.id, edition: "Beta", year: 1993 })}
                          >Beta</Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : !auditQuery.isLoading ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No vintage candidates found for this filter.
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
