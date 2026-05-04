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
import { RefreshCw, Sparkles, CheckCircle2, AlertCircle, Zap } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface BulkRarityReanalyzeProps {
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
  const [confirmAll, setConfirmAll] = useState(false);

  const fetchCardIds = async (force: boolean): Promise<string[]> => {
    const pageSize = 1000;
    let from = 0;
    const ids: string[] = [];
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) throw new Error("Not signed in");

    while (true) {
      let q = supabase
        .from("cards")
        .select("id")
        .eq("user_id", uid)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (force) {
        // "Reanalyze ALL" = every card currently in the Cards Needing Review queue
        // (low OCR confidence OR missing rarity/name/set)
        q = q.or(
          "ocr_confidence.lt.80,rarity.is.null,rarity.eq.,rarity.eq.Unknown,rarity.eq.unknown,card_name.is.null,card_name.eq.,card_name.eq.Unknown,card_set.is.null,card_set.eq.,card_set.eq.Unknown"
        );
      } else {
        q = q.or("rarity.is.null,rarity.eq.,rarity.eq.Unknown,rarity.eq.unknown");
      }
      const { data, error } = await q;
      if (error) throw error;
      const batch = (data || []).map((row) => row.id as string);
      ids.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }
    return ids;
  };

  const runReanalyze = async (force: boolean) => {
    setIsProcessing(true);
    setProgress(0);
    setProcessed(0);
    setUpdated(0);

    const batchSize = 12;
    let totalProcessed = 0;
    let totalUpdated = 0;

    try {
      const ids = await fetchCardIds(force);

      if (ids.length === 0) {
        toast.info("No cards to process");
        setIsProcessing(false);
        onComplete?.();
        return;
      }

      toast.info(`Reanalyzing ${ids.length} card(s)…`);

      for (let i = 0; i < ids.length; i += batchSize) {
        const cardIds = ids.slice(i, i + batchSize);

        const { data, error } = await supabase.functions.invoke(
          "bulk-reanalyze-rarity",
          {
            body: { cardIds, force },
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

        totalProcessed += data.processed || 0;
        totalUpdated += data.updated || 0;
        setProcessed(totalProcessed);
        setUpdated(totalUpdated);

        const attempted = Math.min(ids.length, i + cardIds.length);
        setProgress(Math.round((attempted / ids.length) * 100));

        await new Promise((r) => setTimeout(r, 120));
      }

      setProgress(100);
      const unresolved = Math.max(0, totalProcessed - totalUpdated);
      if (unresolved > 0) {
        toast.success(
          `Done. Updated ${totalUpdated} card(s). ${unresolved} still need manual review.`
        );
      } else {
        toast.success(`Done! Updated rarity for ${totalUpdated} cards`);
      }
      onComplete?.();
    } catch (err: any) {
      console.error("Reanalyze error:", err);
      toast.error(err?.message || "Error during reanalysis");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Rarity Reanalysis
        </CardTitle>
        <CardDescription>
          Fill missing rarity, or force a fresh AI pass on every card in your collection.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            {nullRarityCount === 0 ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span>No missing rarity</span>
              </>
            ) : (
              <>
                <AlertCircle className="h-4 w-4" />
                <span>{nullRarityCount} cards need rarity</span>
              </>
            )}
          </div>
          {isProcessing && (
            <div className="text-muted-foreground">
              Updated {updated} / Processed {processed}
            </div>
          )}
        </div>

        {isProcessing && <Progress value={progress} />}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button
            onClick={() => runReanalyze(false)}
            disabled={isProcessing || nullRarityCount === 0}
            variant="outline"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isProcessing ? "animate-spin" : ""}`} />
            Fix Missing ({nullRarityCount})
          </Button>
          <Button
            onClick={() => setConfirmAll(true)}
            disabled={isProcessing}
          >
            <Zap className="h-4 w-4 mr-2" />
            Reanalyze ALL
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reanalyze every card?</AlertDialogTitle>
            <AlertDialogDescription>
              This will run AI rarity detection against every card in your collection
              and overwrite the existing rarity field. This uses AI credits and may take
              a while. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmAll(false);
                runReanalyze(true);
              }}
            >
              Reanalyze All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
