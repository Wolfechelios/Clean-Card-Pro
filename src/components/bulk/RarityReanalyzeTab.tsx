import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Loader2, Hash } from "lucide-react";
import { useState } from "react";
import { toast } from "@/hooks/use-toast";

export default function RarityReanalyzeTab() {
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<{
    analyzed: number;
    setUpdated: number;
    numberUpdated: number;
    nameUpdated: number;
  } | null>(null);

  const runMutation = useMutation({
    mutationFn: async () => {
      setRunning(true);
      setProgress(0);
      setStats({ analyzed: 0, setUpdated: 0, numberUpdated: 0, nameUpdated: 0 });
      let analyzed = 0, setU = 0, numU = 0, nameU = 0;
      for (let i = 0; i < 30; i++) {
        const { data, error } = await supabase.functions.invoke("bulk-reanalyze-rarity", {
          body: { batchSize: 12 },
        });
        if (error) {
          toast({ title: "Failed", description: error.message, variant: "destructive" });
          break;
        }
        const a = data?.processed || 0;
        analyzed += a;
        setU += data?.setUpdated || 0;
        numU += data?.numberUpdated || 0;
        nameU += data?.nameUpdated || 0;
        setStats({ analyzed, setUpdated: setU, numberUpdated: numU, nameUpdated: nameU });
        setProgress(Math.min(100, (i + 1) * 4));
        if (a === 0) break;
      }
      setProgress(100);
      setRunning(false);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Hash className="h-5 w-5" /> Fill Missing Set & Number
        </CardTitle>
        <CardDescription>
          Sweeps cards missing set name or card number and uses Gemini vision on the stored image to fill them in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button disabled={running} onClick={() => runMutation.mutate()}>
          {running ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing…</> : "Start Set/Number Analysis"}
        </Button>
        {(running || progress > 0) && <Progress value={progress} />}
        {stats && (
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge variant="outline">Analyzed: {stats.analyzed}</Badge>
            <Badge variant="default">Set: {stats.setUpdated}</Badge>
            <Badge variant="default">Number: {stats.numberUpdated}</Badge>
            <Badge variant="secondary">Name: {stats.nameUpdated}</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
