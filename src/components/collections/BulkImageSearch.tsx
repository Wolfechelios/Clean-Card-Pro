import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ImagePlus, Loader2, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

interface BulkImageSearchProps {
  onComplete?: () => void;
}

export function BulkImageSearch({ onComplete }: BulkImageSearchProps) {
  const { userId } = useAuth();
  const [missingCount, setMissingCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{
    found: number;
    not_found: number;
    errors: number;
  } | null>(null);

  useEffect(() => {
    if (userId) {
      loadMissingCount();
    }
  }, [userId]);

  const loadMissingCount = async () => {
    setIsLoading(true);
    try {
      // Count cards that truly need images (placeholders or null)
      const { count, error } = await supabase
        .from("cards")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("image_locked", false)
        .or("image_url.is.null,image_url.ilike.%placehold%");

      if (error) throw error;
      setMissingCount(count || 0);
    } catch (error) {
      console.error("Error loading missing count:", error);
      setMissingCount(0);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBulkSearch = async () => {
    if (!userId || missingCount === 0) return;

    setIsProcessing(true);
    setProgress(0);
    setResults(null);

    try {
      // Process in batches of 25
      const batchSize = 25;
      const totalBatches = Math.ceil((missingCount || 0) / batchSize);
      let totalFound = 0;
      let totalNotFound = 0;
      let totalErrors = 0;

      for (let i = 0; i < totalBatches; i++) {
        const { data, error } = await supabase.functions.invoke("resolve-missing-images", {
          body: { limit: batchSize },
        });

        if (error) throw error;

        totalFound += data.found || 0;
        totalNotFound += data.not_found || 0;
        totalErrors += data.errors || 0;

        setProgress(Math.round(((i + 1) / totalBatches) * 100));

        // Stop if no more cards to process
        if (data.processed < batchSize) break;
      }

      setResults({
        found: totalFound,
        not_found: totalNotFound,
        errors: totalErrors,
      });

      if (totalFound > 0) {
        toast.success(`Found ${totalFound} images`);
      } else {
        toast.info("No new images found");
      }

      // Refresh count
      await loadMissingCount();
      onComplete?.();
    } catch (error: any) {
      console.error("Bulk search error:", error);
      toast.error("Failed to search for images");
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Find Missing Images</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ImagePlus className="h-5 w-5" />
          Find Missing Images
        </CardTitle>
        <CardDescription>
          Search for card images from Scryfall, Pokemon TCG, YGOPRODeck, and eBay
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {missingCount === 0 ? (
          <div className="flex items-center gap-2 text-success">
            <CheckCircle className="h-5 w-5" />
            <span>All cards have images!</span>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4 inline mr-1" />
              {missingCount} cards without images
            </p>

            {isProcessing ? (
              <div className="space-y-2">
                <Progress value={progress} className="h-2" />
                <p className="text-sm text-muted-foreground text-center">
                  Searching... {progress}%
                </p>
              </div>
            ) : (
              <Button onClick={handleBulkSearch} className="w-full">
                <ImagePlus className="h-4 w-4 mr-2" />
                Find Images ({missingCount} cards)
              </Button>
            )}

            {results && (
              <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-1 text-success">
                  <CheckCircle className="h-4 w-4" />
                  <span>{results.found} found</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <XCircle className="h-4 w-4" />
                  <span>{results.not_found} not found</span>
                </div>
                {results.errors > 0 && (
                  <div className="flex items-center gap-1 text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    <span>{results.errors} errors</span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
