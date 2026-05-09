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
import { AlertTriangle, CheckCircle2, Hash, RefreshCw, ShieldCheck } from "lucide-react";

interface BulkSetNumberReanalyzeProps {
  suspectSetNumberCount: number;
  onComplete?: () => void;
}

export function BulkSetNumberReanalyze({
  suspectSetNumberCount,
  onComplete,
}: BulkSetNumberReanalyzeProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [updated, setUpdated] = useState(0);
  const [reviewOnly, setReviewOnly] = useState(0);

  const fetchSuspectCardIds = async (): Promise<string[]> => {
    const pageSize = 1000;
    let from = 0;
    const ids: string[] = [];

    while (true) {
      const { data, error } = await supabase
        .from("cards")
        .select("id")
        .or("card_set.is.null,card_set.eq.,card_number.is.null,card_number.eq.")
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
    if (suspectSetNumberCount === 0) {
      toast.info("No cards with missing set or number to process");
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setProcessed(0);
    setUpdated(0);
    setReviewOnly(0);

    const batchSize = 10;
    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalReviewOnly = 0;

    try {
      const missingIds = await fetchSuspectCardIds();

      if (missingIds.length === 0) {
        toast.info("No cards with missing set or number to process");
        setIsProcessing(false);
        onComplete?.();
        return;
      }

      for (let i = 0; i < missingIds.length; i += batchSize) {
        const cardIds = missingIds.slice(i, i + batchSize);

        const { data, error } = await supabase.functions.invoke(
          "bulk-reanalyze-set-number",
          {
            body: { cardIds },
          }
        );

        if (error) {
          console.error("Set/# batch error:", error);
          toast.error(`Set/# batch failed: ${error.message}`);
          break;
        }

        if (!data?.success) {
          toast.error(data?.error || "Unknown Set/# reanalysis error");
          break;
        }

        const batchProcessed = data.processed || 0;
        const batchUpdated = data.updated || 0;
        const batchReviewOnly = data.reviewOnly || 0;

        totalProcessed += batchProcessed;
        totalUpdated += batchUpdated;
        totalReviewOnly += batchReviewOnly;

        setProcessed(totalProcessed);
        setUpdated(totalUpdated);
        setReviewOnly(totalReviewOnly);

        const attempted = Math.min(missingIds.length, i + cardIds.length);
        setProgress(Math.round((attempted / missingIds.length) * 100));

        await new Promise((r) => setTimeout(r, 150));
      }

      setProgress(100);
      toast.success(
        `Set/# reanalysis complete. Updated ${totalUpdated}; flagged ${totalReviewOnly} for review.`
      );
      onComplete?.();
    } catch (err: any) {
      console.error("Set/# reanalysis error:", err);
      toast.error(err?.message || "Error during Set/# reanalysis");
    } finally {
      setIsProcessing(false);
    }
  };

  if (suspectSetNumberCount === 0) {
    return (
      <Card className="border-success/20 bg-success/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            Set + Number is complete
          </CardTitle>
          <CardDescription>No missing set names or collector numbers found.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Hash className="h-4 w-4 text-primary" />
          Set + Number Reanalysis
        </CardTitle>
        <CardDescription>
          Rechecks set name, set code, collector number, print variant, and edition without replacing the full card.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            <span>{suspectSetNumberCount} cards need Set/# review</span>
          </div>
          {isProcessing && (
            <div className="text-muted-foreground">
              Updated {updated} / Processed {processed} / Review {reviewOnly}
            </div>
          )}
        </div>

        {isProcessing && <Progress value={progress} />}

        <Button onClick={handleReanalyze} disabled={isProcessing} className="w-full">
          {isProcessing ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Rechecking Set / #…
            </>
          ) : (
            <>
              <ShieldCheck className="h-4 w-4 mr-2" />
              Recheck Set / #
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
