import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";

interface BulkRarityReanalyzeProps {
  // This should represent "missing rarity" count (null/empty/Unknown)
  nullRarityCount: number;
  onComplete?: () => void;
}

export function BulkRarityReanalyze({
  nullRarityCount,
  onComplete,
}: BulkRarityReanalyzeProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [updated, setUpdated] = useState(0);

  const fetchMissingCardIds = async (): Promise<string[]> => {
    const pageSize = 1000;
    let from = 0;
    const ids: string[] = [];

    while (true) {
      const { data, error } = await supabase
        .from("cards")
        .select("id")
        .or("rarity.is.null,rarity.eq.,rarity.eq.Unknown,rarity.eq.unknown")
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) throw error;

      const batch = (data || []).map((row) => row.id as string);
      ids.push(...batch);

      if (batch.length < pageSize) break;
      from += pageSize;
    }

    return ids;
  };

  const handleReanalyze = async () => {
    if (nullRarityCount === 0) {
      toast.info("No cards with missing rarity to process");
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setProcessed(0);
    setUpdated(0);

    const batchSize = 12;
    let totalProcessed = 0;
    let totalUpdated = 0;

    try {
      const missingIds = await fetchMissingCardIds();

      if (missingIds.length === 0) {
        toast.info("No cards with missing rarity to process");
        setIsProcessing(false);
        onComplete?.();
        return;
      }

      for (let i = 0; i < missingIds.length; i += batchSize) {
        const cardIds = missingIds.slice(i, i + batchSize);

        const { data, error } = await supabase.functions.invoke(
          "bulk-reanalyze-rarity",
          {
            body: { cardIds },
          }
        );

        if (error) {
          console.error("Batch error:", error);
          toast.error(`Error processing batch: ${error.message}`);
          break;
        }

        if (!data?.success) {
          toast.error(data?.error || "Unknown error");
          break;
        }

        const batchProcessed = data.processed || 0;
        const batchUpdated = data.updated || 0;

        totalProcessed += batchProcessed;
        totalUpdated += batchUpdated;

        setProcessed(totalProcessed);
        setUpdated(totalUpdated);

        const attempted = Math.min(missingIds.length, i + cardIds.length);
        setProgress(Math.round((attempted / missingIds.length) * 100));

        // Small delay between batches to avoid API burst limits
        await new Promise((r) => setTimeout(r, 120));
      }

      setProgress(100);

      const unresolved = Math.max(0, totalProcessed - totalUpdated);
      if (unresolved > 0) {
        toast.success(
          `Completed. Updated ${totalUpdated} card(s). ${unresolved} still need manual review.`
        );
      } else {
        toast.success(`Completed! Updated rarity for ${totalUpdated} cards`);
      }

      onComplete?.();
    } catch (err: any) {
      console.error("Reanalyze error:", err);
      toast.error(err?.message || "Error during reanalysis");
    } finally {
      setIsProcessing(false);
    }
  };

  if (nullRarityCount === 0) {
    return (
      <Card className="border-success/20 bg-success/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            Rarity is complete
          </CardTitle>
          <CardDescription>Nothing missing. Go cause problems elsewhere.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Fill Missing Rarity
        </CardTitle>
        <CardDescription>
          Updates only cards missing rarity (null / empty / Unknown).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <span>{nullRarityCount} cards need rarity</span>
          </div>
          {isProcessing && (
            <div className="text-muted-foreground">
              Updated {updated} / Processed {processed}
            </div>
          )}
        </div>

        {isProcessing && <Progress value={progress} />}

        <Button
          onClick={handleReanalyze}
          disabled={isProcessing}
          className="w-full"
        >
          {isProcessing ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Processing…
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Run Missing Rarity Fix
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
