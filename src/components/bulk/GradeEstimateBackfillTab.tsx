import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Award, Pause, Play, X } from "lucide-react";
import { useBulkJob } from "@/hooks/use-bulk-job";

interface CardRow { id: string; card_name: string; image_url: string | null; psa10_viable: boolean | null; }
interface JobResult { id: string; card_name: string; viable: boolean | null; confidence: number | null; status: "updated" | "error" | "skipped"; error?: string; }

export default function GradeEstimateBackfillTab() {
  const q = useQuery({
    queryKey: ["grade-estimate-candidates"],
    staleTime: 10_000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("cards")
        .select("id, card_name, image_url, psa10_viable")
        .eq("user_id", user.id)
        .is("psa10_viable", null)
        .not("image_url", "is", null)
        .limit(1000);
      if (error) throw error;
      return (data || []) as CardRow[];
    },
  });

  const job = useBulkJob<CardRow, JobResult>({
    jobKey: "grade-estimate-backfill",
    batchSize: 1, // analyze one image at a time per worker
    concurrency: 3,
    throttleMs: 300,
    runBatch: async (batch) => {
      const card = batch[0];
      try {
        const { data, error } = await supabase.functions.invoke("analyze-psa10-viability", {
          body: { card_id: card.id },
        });
        if (error) {
          return [{ id: card.id, card_name: card.card_name, viable: null, confidence: null, status: "error", error: error.message }];
        }
        return [{
          id: card.id, card_name: card.card_name,
          viable: data?.psa10_viable ?? null,
          confidence: data?.confidence ?? null,
          status: "updated",
        }];
      } catch (e) {
        return [{ id: card.id, card_name: card.card_name, viable: null, confidence: null, status: "error", error: (e as Error).message }];
      }
    },
  });

  const candidates = q.data || [];
  const viableCount = job.state.results.filter((r) => r.viable).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Award className="h-5 w-5" /> Grade Estimate Backfill</CardTitle>
        <CardDescription>Runs PSA 10 viability analysis on cards that haven't been graded yet. Skips cards without an image.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            {q.isLoading ? "Counting…" : `${candidates.length} cards need analysis`}
          </div>
          <div className="flex gap-2">
            {!job.state.running ? (
              <>
                <Button onClick={() => job.start(candidates)} disabled={!candidates.length}>Start analysis</Button>
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
              {job.state.processed}/{job.state.total} · {viableCount} flagged PSA 10 viable
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
                  <th className="px-2 py-1">PSA 10?</th>
                  <th className="px-2 py-1 text-right">Confidence</th>
                  <th className="px-2 py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {job.state.results.slice(-200).reverse().map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="px-2 py-1">{r.card_name}</td>
                    <td className="px-2 py-1">
                      {r.viable === true ? <Badge>Viable</Badge> :
                       r.viable === false ? <Badge variant="secondary">No</Badge> : "—"}
                    </td>
                    <td className="px-2 py-1 text-right">{r.confidence != null ? `${r.confidence}%` : "—"}</td>
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
