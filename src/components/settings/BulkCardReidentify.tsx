import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Search, Image, Loader2, CheckCircle2, XCircle, Play, Pause, StopCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface BulkCardReidentifyProps {
  onComplete?: () => void;
}

interface CardToProcess {
  id: string;
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  player_name: string | null;
  year: number | null;
  game_type: string | null;
  sport_type: string | null;
  image_url: string;
}

type FilterMode = "all" | "missing-images" | "unknown-names" | "both";

const BATCH_SIZE = 200;

export function BulkCardReidentify({ onComplete }: BulkCardReidentifyProps) {
  const { userId } = useAuth();
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isStopped, setIsStopped] = useState(false);
  const [totalCards, setTotalCards] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [currentCard, setCurrentCard] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>("missing-images");
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);

  // Fetch estimated count when filter changes
  useEffect(() => {
    const fetchEstimate = async () => {
      if (!userId) return;
      
      let query = supabase
        .from("cards")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);

      if (filterMode === "missing-images") {
        query = query.or("image_url.is.null,image_url.eq.,image_url.ilike.%placeholder%");
      } else if (filterMode === "unknown-names") {
        query = query.or("card_name.eq.Unknown Card,card_name.eq.unknown,card_name.eq.");
      } else if (filterMode === "both") {
        query = query.or("image_url.is.null,image_url.eq.,image_url.ilike.%placeholder%,card_name.eq.Unknown Card,card_name.eq.unknown,card_name.eq.");
      }

      const { count } = await query;
      setEstimatedCount(count || 0);
    };

    fetchEstimate();
  }, [userId, filterMode]);

  const fetchCardsToProcess = async (): Promise<CardToProcess[]> => {
    if (!userId) return [];

    let query = supabase
      .from("cards")
      .select("id, card_name, card_set, card_number, player_name, year, game_type, sport_type, image_url")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (filterMode === "missing-images") {
      query = query.or("image_url.is.null,image_url.eq.,image_url.ilike.%placeholder%");
    } else if (filterMode === "unknown-names") {
      query = query.or("card_name.eq.Unknown Card,card_name.eq.unknown,card_name.eq.");
    } else if (filterMode === "both") {
      query = query.or("image_url.is.null,image_url.eq.,image_url.ilike.%placeholder%,card_name.eq.Unknown Card,card_name.eq.unknown,card_name.eq.");
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching cards:", error);
      return [];
    }

    return data || [];
  };

  const identifyAndLookupImage = async (card: CardToProcess): Promise<boolean> => {
    try {
      // Build search text from card info
      const searchParts = [
        card.card_name,
        card.player_name,
        card.card_set,
        card.card_number ? `#${card.card_number}` : null,
        card.year?.toString(),
      ].filter(Boolean);

      const searchText = searchParts.join(" ");

      // Step 1: Re-identify the card using enhanced-card-identify
      const { data: identifyData, error: identifyError } = await supabase.functions.invoke(
        "enhanced-card-identify",
        {
          body: {
            searchText,
            gameType: card.game_type || card.sport_type,
          },
        }
      );

      if (identifyError) {
        console.error("Identify error for card:", card.id, identifyError);
        return false;
      }

      // Update card with new identification data if found
      if (identifyData?.card) {
        const updateData: Record<string, any> = {};
        
        if (identifyData.card.name) updateData.card_name = identifyData.card.name;
        if (identifyData.card.set) updateData.card_set = identifyData.card.set;
        if (identifyData.card.number) updateData.card_number = identifyData.card.number;
        if (identifyData.card.rarity) updateData.rarity = identifyData.card.rarity;
        if (identifyData.card.year) updateData.year = identifyData.card.year;

        if (Object.keys(updateData).length > 0) {
          await supabase
            .from("cards")
            .update(updateData)
            .eq("id", card.id);
        }
      }

      // Step 2: Look up and attach image
      const { data: imageData, error: imageError } = await supabase.functions.invoke(
        "generate-card-image-url",
        {
          body: {
            cardName: identifyData?.card?.name || card.card_name,
            cardSet: identifyData?.card?.set || card.card_set,
            gameType: card.game_type || card.sport_type,
          },
        }
      );

      if (imageError) {
        console.error("Image lookup error for card:", card.id, imageError);
        return false;
      }

      if (imageData?.found && imageData?.imageUrl && !imageData.imageUrl.includes("placehold")) {
        // Attach the image to the card
        const { error: attachError } = await supabase.functions.invoke("attach-image", {
          body: {
            cardId: card.id,
            remoteImageUrl: imageData.imageUrl,
          },
        });

        if (attachError) {
          console.error("Attach image error for card:", card.id, attachError);
          return false;
        }

        return true;
      }

      return false;
    } catch (err) {
      console.error("Error processing card:", card.id, err);
      return false;
    }
  };

  const processBatch = async (cards: CardToProcess[], batchIndex: number, stopRef: { current: boolean }): Promise<{ success: number; failed: number; stopped: boolean }> => {
    let success = 0;
    let failed = 0;

    for (const card of cards) {
      // Check if stopped
      if (stopRef.current) {
        return { success, failed, stopped: true };
      }

      if (isPaused) {
        // Wait while paused, but also check for stop
        await new Promise<void>((resolve) => {
          const checkPaused = setInterval(() => {
            if (stopRef.current || !isPaused) {
              clearInterval(checkPaused);
              resolve();
            }
          }, 500);
        });
        
        if (stopRef.current) {
          return { success, failed, stopped: true };
        }
      }

      setCurrentCard(card.card_name);

      const result = await identifyAndLookupImage(card);
      
      if (result) {
        success++;
        setSuccessCount((prev) => prev + 1);
      } else {
        failed++;
        setFailedCount((prev) => prev + 1);
      }

      setProcessedCount((prev) => prev + 1);

      // Small delay between cards to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    return { success, failed, stopped: false };
  };

  const stopRef = { current: false };

  const startProcessing = async () => {
    if (!userId) {
      toast.error("You must be logged in");
      return;
    }

    setIsRunning(true);
    setIsPaused(false);
    setIsStopped(false);
    stopRef.current = false;
    setProcessedCount(0);
    setSuccessCount(0);
    setFailedCount(0);
    setCurrentBatch(0);

    try {
      const allCards = await fetchCardsToProcess();
      
      if (allCards.length === 0) {
        toast.info("No cards to process");
        setIsRunning(false);
        return;
      }

      setTotalCards(allCards.length);
      const batches = Math.ceil(allCards.length / BATCH_SIZE);
      setTotalBatches(batches);

      toast.info(`Starting re-identification of ${allCards.length} cards in ${batches} batches`);

      let totalSuccess = 0;
      let totalFailed = 0;

      for (let i = 0; i < batches; i++) {
        if (stopRef.current) {
          toast.info(`Stopped after processing ${processedCount} cards`);
          break;
        }

        setCurrentBatch(i + 1);
        const start = i * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, allCards.length);
        const batchCards = allCards.slice(start, end);

        const result = await processBatch(batchCards, i, stopRef);
        totalSuccess += result.success;
        totalFailed += result.failed;

        if (result.stopped) {
          toast.info(`Stopped after processing ${processedCount} cards`);
          break;
        }

        // Brief pause between batches
        if (i < batches - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      if (!stopRef.current) {
        toast.success(`Completed! ${totalSuccess} cards updated, ${totalFailed} failed`);
      }
      onComplete?.();
    } catch (err) {
      console.error("Bulk re-identify error:", err);
      toast.error("An error occurred during processing");
    } finally {
      setIsRunning(false);
      setCurrentCard(null);
    }
  };

  const stopProcessing = () => {
    stopRef.current = true;
    setIsStopped(true);
    setIsPaused(false);
  };

  const togglePause = () => {
    setIsPaused(!isPaused);
  };

  const progress = totalCards > 0 ? (processedCount / totalCards) * 100 : 0;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground mb-3">
          Search and re-identify cards by their text information, then look up images. Processes in batches of {BATCH_SIZE} cards.
        </p>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="filter-mode" className="text-sm">Filter cards to process</Label>
            <Select 
              value={filterMode} 
              onValueChange={(v) => setFilterMode(v as FilterMode)}
              disabled={isRunning}
            >
              <SelectTrigger id="filter-mode" className="w-full max-w-xs">
                <SelectValue placeholder="Select filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="missing-images">Missing images only</SelectItem>
                <SelectItem value="unknown-names">Unknown names only</SelectItem>
                <SelectItem value="both">Missing images OR unknown names</SelectItem>
                <SelectItem value="all">All cards</SelectItem>
              </SelectContent>
            </Select>
            {estimatedCount !== null && (
              <p className="text-xs text-muted-foreground">
                {estimatedCount} card{estimatedCount !== 1 ? 's' : ''} match this filter
              </p>
            )}
          </div>
        
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={startProcessing}
              disabled={isRunning || estimatedCount === 0}
            >
              {isRunning ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              {isRunning ? "Processing..." : "Re-identify & Find Images"}
            </Button>

            {isRunning && (
              <>
                <Button variant="outline" onClick={togglePause} disabled={isStopped}>
                  {isPaused ? (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Resume
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4 mr-2" />
                      Pause
                    </>
                  )}
                </Button>
                <Button variant="destructive" onClick={stopProcessing} disabled={isStopped}>
                  <StopCircle className="h-4 w-4 mr-2" />
                  Stop All
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {isRunning && (
        <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
          <div className="flex items-center justify-between text-sm">
            <span>
              Batch {currentBatch} of {totalBatches}
            </span>
            <span>
              {processedCount} / {totalCards} cards
            </span>
          </div>

          <Progress value={progress} className="h-2" />

          <div className="flex gap-2 flex-wrap">
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              {successCount} updated
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <XCircle className="h-3 w-3 text-red-500" />
              {failedCount} failed
            </Badge>
            {isPaused && (
              <Badge variant="outline" className="gap-1 text-warning">
                Paused
              </Badge>
            )}
          </div>

          {currentCard && (
            <p className="text-xs text-muted-foreground truncate">
              <Image className="h-3 w-3 inline mr-1" />
              Processing: {currentCard}
            </p>
          )}
        </div>
      )}

      {!isRunning && processedCount > 0 && (
        <div className="p-3 border rounded-lg bg-muted/30">
          <p className="text-sm font-medium">Last Run Results:</p>
          <div className="flex gap-2 mt-2">
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              {successCount} updated
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <XCircle className="h-3 w-3 text-red-500" />
              {failedCount} failed
            </Badge>
          </div>
        </div>
      )}
    </div>
  );
}
