import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ImagePlus, RefreshCw, Loader2, CheckCircle, XCircle, AlertCircle, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { isPlaceholderUrl, toPublicImageUrl } from "@/lib/storage/getPublicImageUrl";

interface BulkImageSearchProps {
  onComplete?: () => void;
}

type ImageAuditCard = {
  id: string;
  image_url: string | null;
  thumbnail_url: string | null;
};

export function BulkImageSearch({ onComplete }: BulkImageSearchProps) {
  const { userId } = useAuth();
  const [missingCount, setMissingCount] = useState<number | null>(null);
  const [externalCount, setExternalCount] = useState<number | null>(null);
  const [repairableCount, setRepairableCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
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
        .or("image_url.is.null,image_url.eq.,image_url.ilike.%placehold%,image_url.ilike.%placeholder%,image_url.eq.null,image_url.eq.undefined");

      if (error) throw error;
      setMissingCount(count || 0);

      // Pull image refs once and classify locally. This catches raw bucket paths and expired signed URLs
      // without needing extra database columns or destructive cleanup.
      const { data: allCards, error: allError } = await supabase
        .from("cards")
        .select("id, image_url, thumbnail_url")
        .eq("user_id", userId)
        .eq("image_locked", false);

      if (allError) throw allError;

      const cards = (allCards || []) as ImageAuditCard[];
      const externalCards = cards.filter(card => isExternalImageUrl(card.image_url));
      const repairableCards = cards.filter(card => needsUrlRepair(card));

      setExternalCount(externalCards.length);
      setRepairableCount(repairableCards.length);
    } catch (error) {
      console.error("Error loading counts:", error);
      setMissingCount(0);
      setExternalCount(0);
      setRepairableCount(0);
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

  const handleRepairStoredUrls = async () => {
    if (!userId || repairableCount === 0) return;

    setIsRepairing(true);
    setProgress(0);
    setResults(null);

    try {
      const { data, error } = await supabase
        .from("cards")
        .select("id, image_url, thumbnail_url")
        .eq("user_id", userId)
        .eq("image_locked", false);

      if (error) throw error;

      const cards = ((data || []) as ImageAuditCard[]).filter(needsUrlRepair);
      let repaired = 0;
      let failed = 0;

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const updates: Record<string, string | null> = {};

        const fixedImageUrl = normalizeStoredField(card.image_url);
        const fixedThumbnailUrl = normalizeStoredField(card.thumbnail_url);

        if (fixedImageUrl !== card.image_url) updates.image_url = fixedImageUrl;
        if (fixedThumbnailUrl !== card.thumbnail_url) updates.thumbnail_url = fixedThumbnailUrl;

        if (Object.keys(updates).length > 0) {
          const { error: updateError } = await supabase
            .from("cards")
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq("id", card.id);

          if (updateError) failed++;
          else repaired++;
        }

        setProgress(Math.round(((i + 1) / Math.max(1, cards.length)) * 100));
      }

      setResults({ found: repaired, not_found: 0, errors: failed });

      if (repaired > 0) toast.success(`Repaired ${repaired} stored image URL${repaired === 1 ? "" : "s"}`);
      else toast.info("No repairable image URLs found");
      if (failed > 0) toast.warning(`${failed} image URL repair${failed === 1 ? "" : "s"} failed`);

      await loadCounts();
      onComplete?.();
    } catch (error) {
      console.error("Repair image URLs error:", error);
      toast.error("Failed to repair stored image URLs");
    } finally {
      setIsRepairing(false);
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

  const isWorking = isProcessing || isRefreshing || isRepairing;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <ImagePlus className="h-5 w-5" />
          Image Management
        </CardTitle>
        <CardDescription>
          Find missing images, repair stale links, and store external images to cloud storage
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Missing:</span>
            <span className="font-medium">{missingCount}</span>
          </div>
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Repairable:</span>
            <span className="font-medium">{repairableCount}</span>
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
            onClick={handleRepairStoredUrls}
            disabled={isWorking || repairableCount === 0}
            variant="outline"
            className="w-full"
          >
            {isRepairing ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Wrench className="h-4 w-4 mr-2" />
            )}
            Repair Stored Image Links ({repairableCount})
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
              {isProcessing ? "Searching..." : isRepairing ? "Repairing..." : "Storing..."} {progress}%
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
        {missingCount === 0 && externalCount === 0 && repairableCount === 0 && (
          <div className="flex items-center gap-2 text-success">
            <CheckCircle className="h-5 w-5" />
            <span>All images are stored with clean cloud links.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function normalizeStoredField(value: string | null): string | null {
  if (!value || isPlaceholderUrl(value)) return value;
  const fixed = toPublicImageUrl(value);
  return fixed || value;
}

function needsUrlRepair(card: ImageAuditCard): boolean {
  return fieldNeedsRepair(card.image_url) || fieldNeedsRepair(card.thumbnail_url);
}

function fieldNeedsRepair(value: string | null): boolean {
  if (!value || isPlaceholderUrl(value)) return false;
  const fixed = toPublicImageUrl(value);
  return Boolean(fixed && fixed !== value);
}

function isExternalImageUrl(value: string | null): boolean {
  if (!value || isPlaceholderUrl(value)) return false;
  const url = value.trim();
  if (!/^https?:\/\//i.test(url)) return false;
  return !url.includes("/storage/v1/object/public/card-images/") && !url.includes("/storage/v1/object/sign/card-images/");
}
