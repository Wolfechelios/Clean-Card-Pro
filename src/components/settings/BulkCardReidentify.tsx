import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Search, Image, Loader2, CheckCircle2, XCircle, Play, Pause } from "lucide-react";
import { Badge } from "@/components/ui/badge";

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
}

const BATCH_SIZE = 200;

export function BulkCardReidentify({ onComplete }: BulkCardReidentifyProps) {
  const { userId } = useAuth();
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [totalCards, setTotalCards] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [currentCard, setCurrentCard] = useState<string | null>(null);

  const fetchCardsToProcess = async (): Promise<CardToProcess[]> => {
    if (!userId) return [];

    const { data, error } = await supabase
      .from("cards")
      .select("id, card_name, card_set, card_number, player_name, year, game_type, sport_type")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

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

  const processBatch = async (cards: CardToProcess[], batchIndex: number): Promise<{ success: number; failed: number }> => {
    let success = 0;
    let failed = 0;

    for (const card of cards) {
      if (isPaused) {
        // Wait while paused
        await new Promise<void>((resolve) => {
          const checkPaused = setInterval(() => {
            if (!isPaused) {
              clearInterval(checkPaused);
              resolve();
            }
          }, 500);
        });
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

    return { success, failed };
  };

  const startProcessing = async () => {
    if (!userId) {
      toast.error("You must be logged in");
      return;
    }

    setIsRunning(true);
    setIsPaused(false);
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

      for (let i = 0; i < batches; i++) {
        setCurrentBatch(i + 1);
        const start = i * BATCH_SIZE;
        const end = Math.min(start + BATCH_SIZE, allCards.length);
        const batchCards = allCards.slice(start, end);

        await processBatch(batchCards, i);

        // Brief pause between batches
        if (i < batches - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      toast.success(`Completed! ${successCount} cards updated, ${failedCount} failed`);
      onComplete?.();
    } catch (err) {
      console.error("Bulk re-identify error:", err);
      toast.error("An error occurred during processing");
    } finally {
      setIsRunning(false);
      setCurrentCard(null);
    }
  };

  const togglePause = () => {
    setIsPaused(!isPaused);
  };

  const progress = totalCards > 0 ? (processedCount / totalCards) * 100 : 0;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground mb-2">
          Search and re-identify cards by their text information, then look up images. Processes in batches of {BATCH_SIZE} cards.
        </p>
        
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={startProcessing}
            disabled={isRunning}
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Search className="h-4 w-4 mr-2" />
            )}
            {isRunning ? "Processing..." : "Re-identify & Find Images"}
          </Button>

          {isRunning && (
            <Button variant="outline" onClick={togglePause}>
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
          )}
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
