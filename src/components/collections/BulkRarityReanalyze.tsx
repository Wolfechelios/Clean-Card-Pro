import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";

interface BulkRarityReanalyzeProps {
  nullRarityCount: number;
  onComplete?: () => void;
}

export function BulkRarityReanalyze({ nullRarityCount, onComplete }: BulkRarityReanalyzeProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [updated, setUpdated] = useState(0);

  const handleReanalyze = async () => {
    if (nullRarityCount === 0) {
      toast.info("No cards with missing rarity to process");
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setProcessed(0);
    setUpdated(0);

    const batchSize = 10;
    let offset = 0;
    let totalProcessed = 0;
    let totalUpdated = 0;
    let remaining = nullRarityCount;

    try {
      while (remaining > 0) {
        const { data, error } = await supabase.functions.invoke('bulk-reanalyze-rarity', {
          body: { batchSize, offset }
        });

        if (error) {
          console.error('Batch error:', error);
          toast.error(`Error processing batch: ${error.message}`);
          break;
        }

        if (!data.success) {
          toast.error(data.error || 'Unknown error');
          break;
        }

        totalProcessed += data.processed || 0;
        totalUpdated += data.updated || 0;
        remaining = data.remaining || 0;
        
        setProcessed(totalProcessed);
        setUpdated(totalUpdated);
        setProgress(Math.round(((nullRarityCount - remaining) / nullRarityCount) * 100));

        if (data.processed === 0) break;
        
        // Small delay between batches to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      toast.success(`Completed! Updated rarity for ${totalUpdated} cards`);
      onComplete?.();
    } catch (error: any) {
      console.error('Reanalyze error:', error);
      toast.error(error.message || 'Error during reanalysis');
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
            All Cards Have Rarity
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-warning" />
          Missing Rarity Data
        </CardTitle>
        <CardDescription>
          {nullRarityCount.toLocaleString()} cards have unknown rarity
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isProcessing ? (
          <div className="space-y-3">
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Processing... {processed} cards analyzed</span>
              <span>{updated} updated</span>
            </div>
          </div>
        ) : (
          <Button 
            onClick={handleReanalyze} 
            className="w-full"
            variant="outline"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Re-analyze {nullRarityCount.toLocaleString()} Cards
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Uses AI to detect rarity from card images. This may take a few minutes for large collections.
        </p>
      </CardContent>
    </Card>
  );
}
