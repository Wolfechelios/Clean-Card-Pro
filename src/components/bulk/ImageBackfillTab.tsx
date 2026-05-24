import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Image as ImageIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "@/hooks/use-toast";

const GAMES = [
  { id: "all", label: "All" },
  { id: "mtg", label: "MTG" },
  { id: "pokemon", label: "Pokémon" },
  { id: "yugioh", label: "Yu-Gi-Oh" },
  { id: "sports", label: "Sports" },
] as const;

export default function ImageBackfillTab() {
  const [game, setGame] = useState<typeof GAMES[number]["id"]>("all");
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<{ processed: number; success: number; failed: number } | null>(null);
  const [running, setRunning] = useState(false);

  const runMutation = useMutation({
    mutationFn: async () => {
      setRunning(true); setProgress(0); setStats({ processed: 0, success: 0, failed: 0 });
      let totalProcessed = 0, totalSuccess = 0, totalFailed = 0;
      // Loop until backfill returns 0 processed
      for (let i = 0; i < 20; i++) {
        const { data, error } = await supabase.functions.invoke("backfill-images", {
          body: { limit: 50, game, onlyStatus: "missing", concurrency: 3 },
        });
        if (error) {
          toast({ title: "Backfill failed", description: error.message, variant: "destructive" });
          break;
        }
        const p = data?.processed || 0;
        const s = data?.success || data?.succeeded || 0;
        const f = data?.failed || 0;
        totalProcessed += p; totalSuccess += s; totalFailed += f;
        setStats({ processed: totalProcessed, success: totalSuccess, failed: totalFailed });
        setProgress(Math.min(100, (i + 1) * 5));
        if (p === 0) break;
      }
      setProgress(100);
      setRunning(false);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5" /> Image Backfill
        </CardTitle>
        <CardDescription>
          Finds cards missing images and pulls them from authoritative sources (Scryfall, PokémonTCG, YGOProDeck).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {GAMES.map((g) => (
            <Button
              key={g.id}
              size="sm"
              variant={game === g.id ? "default" : "outline"}
              onClick={() => setGame(g.id)}
            >
              {g.label}
            </Button>
          ))}
        </div>
        <Button disabled={running} onClick={() => runMutation.mutate()}>
          {running ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Backfilling…</> : "Start Backfill"}
        </Button>
        {(running || progress > 0) && <Progress value={progress} />}
        {stats && (
          <div className="flex gap-2 text-sm">
            <Badge variant="outline">Processed: {stats.processed}</Badge>
            <Badge variant="default">Success: {stats.success}</Badge>
            <Badge variant="destructive">Failed: {stats.failed}</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
