import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ImagePlus, RefreshCw, Loader2, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

interface BulkImageSearchProps {
  onComplete?: () => void;
}

export function BulkImageSearch({ onComplete }: BulkImageSearchProps) {
  const { userId } = useAuth();
  const [missingCount, setMissingCount] = useState<number | null>(null);
  const [externalCount, setExternalCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{
    found: number;
    not_found: number;
    errors: number;
  } | null>(null);

  useEffect(() => {
    if (userId) {
      loadCounts();
    }
  }, [userId]);

  const loadCounts = async () => {
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

      // Count cards with external URLs (not from our storage)
      const { data: allCards, error: allError } = await supabase
        .from("cards")
        .select("image_url")
        .eq("user_id", userId)
        .eq("image_locked", false)
        .not("image_url", "is", null)
        .not("image_url", "ilike", "%placehold%");

      if (allError) throw allError;

      // Filter to external URLs only (not from our Supabase storage)
      const externalCards = (allCards || []).filter(card => {
        const url = card.image_url || "";
        return url && !url.includes("supabase") && !url.includes("cyyaapagcftbhafhlofb");
      });
      setExternalCount(externalCards.length);

    } catch (error) {
      console.error("Error loading counts:", error);
      setMissingCount(0);
      setExternalCount(0);
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

        totalFound += data.found || data.success || 0;
        totalNotFound += data.not_found || 0;
        totalErrors += data.errors || data.failed || 0;

        setProgress(Math.round(((i + 1) / totalBatches) * 100));

        if ((data.processed || 0) < batchSize) break;
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

      await loadCounts();
      onComplete?.();
    } catch (error: any) {
      console.error("Bulk search error:", error);
      toast.error("Failed to search for images");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRefreshExternal = async () => {
    if (!userId || externalCount === 0) return;

    setIsRefreshing(true);
    setProgress(0);
    setResults(null);

    try {
      const batchSize = 20;
      const totalBatches = Math.ceil((externalCount || 0) / batchSize);
      let totalSuccess = 0;
      let totalFailed = 0;

      for (let i = 0; i < totalBatches; i++) {
        const { data, error } = await supabase.functions.invoke("refresh-external-images", {
          body: { limit: batchSize },
        });

        if (error) throw error;

        totalSuccess += data.success || 0;
        totalFailed += data.failed || 0;

        setProgress(Math.round(((i + 1) / totalBatches) * 100));

        if ((data.processed || 0) < batchSize) break;
      }

      setResults({
        found: totalSuccess,
        not_found: 0,
        errors: totalFailed,
      });

      if (totalSuccess > 0) {
        toast.success(`Stored ${totalSuccess} images to cloud storage`);
      } else if (totalFailed > 0) {
        toast.warning(`Failed to store ${totalFailed} images`);
      } else {
        toast.info("No external images to refresh");
      }

      await loadCounts();
      onComplete?.();
    } catch (error: any) {
      console.error("Refresh external error:", error);
      toast.error("Failed to refresh external images");
    } finally {
      setIsRefreshing(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Image Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const isWorking = isProcessing || isRefreshing;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ImagePlus className="h-5 w-5" />
          Image Management
        </CardTitle>
        <CardDescription>
          Find missing images and store external images to cloud storage
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Missing:</span>
            <span className="font-medium">{missingCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">External:</span>
            <span className="font-medium">{externalCount}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2">
          <Button 
            onClick={handleBulkSearch} 
            disabled={isWorking || missingCount === 0}
            className="w-full"
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <ImagePlus className="h-4 w-4 mr-2" />
            )}
            Find Missing Images ({missingCount})
          </Button>

          <Button 
            onClick={handleRefreshExternal} 
            disabled={isWorking || externalCount === 0}
            variant="outline"
            className="w-full"
          >
            {isRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Store External Images ({externalCount})
          </Button>
        </div>

        {/* Progress */}
        {isWorking && (
          <div className="space-y-2">
            <Progress value={progress} className="h-2" />
            <p className="text-sm text-muted-foreground text-center">
              {isProcessing ? "Searching..." : "Storing..."} {progress}%
            </p>
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-1 text-success">
              <CheckCircle className="h-4 w-4" />
              <span>{results.found} success</span>
            </div>
            {results.not_found > 0 && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <XCircle className="h-4 w-4" />
                <span>{results.not_found} not found</span>
              </div>
            )}
            {results.errors > 0 && (
              <div className="flex items-center gap-1 text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span>{results.errors} failed</span>
              </div>
            )}
          </div>
        )}

        {/* All good message */}
        {missingCount === 0 && externalCount === 0 && (
          <div className="flex items-center gap-2 text-success">
            <CheckCircle className="h-5 w-5" />
            <span>All images are stored in cloud storage!</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
