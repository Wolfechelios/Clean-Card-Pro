import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { RefreshCw, DollarSign, AlertCircle } from "lucide-react";
import { useGlobalProcessControl } from "@/hooks/use-global-process-control";

export function BulkPriceRefresh() {
  const { userId } = useAuth();
  const { shouldStop } = useGlobalProcessControl();
  const [missingPriceCount, setMissingPriceCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ processed: 0, updated: 0, total: 0 });
  const processStartTime = useRef(0);

  useEffect(() => {
    loadMissingPriceCount();
  }, [userId]);

  const loadMissingPriceCount = async () => {
    if (!userId) return;

    const { count } = await supabase
      .from("cards")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("current_price_raw", null);

    setMissingPriceCount(count || 0);
  };

  const handleBulkRefresh = async () => {
    if (!userId) {
      toast.error("You must be logged in");
      return;
    }

    setIsProcessing(true);
    setProgress({ processed: 0, updated: 0, total: 0 });
    processStartTime.current = Date.now();

    try {
      // Fetch all cards missing prices
      const { data: cards, error } = await supabase
        .from("cards")
        .select("id, card_name, card_set, card_number, game_type, sport_type")
        .eq("user_id", userId)
        .is("current_price_raw", null)
        .limit(500);

      if (error) throw error;
      if (!cards || cards.length === 0) {
        toast.info("No cards missing prices");
        setIsProcessing(false);
        return;
      }

      setProgress({ processed: 0, updated: 0, total: cards.length });
      toast.loading(`Fetching prices for ${cards.length} cards...`, { id: "bulk-price-refresh" });

      let updated = 0;
      const batchSize = 5;

      for (let i = 0; i < cards.length; i += batchSize) {
        if (shouldStop(processStartTime.current)) {
          toast.info("Price refresh stopped", { id: "bulk-price-refresh" });
          break;
        }

        const batch = cards.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (card) => {
            try {
              const { data: priceData, error: priceError } = await supabase.functions.invoke(
                "fetch-card-prices",
                {
                  body: {
                    cardName: card.card_name,
                    cardSet: card.card_set,
                    cardNumber: card.card_number,
                    gameType: card.game_type,
                    sportType: card.sport_type,
                  },
                }
              );

              if (!priceError && priceData && (priceData.raw || priceData.suggested)) {
                const rawPrice = priceData.raw ?? priceData.suggested ?? null;
                
                await supabase
                  .from("cards")
                  .update({
                    current_price_raw: rawPrice,
                    current_price_psa9: priceData.psa9 ?? null,
                    current_price_psa10: priceData.psa10 ?? null,
                    suggested_price: priceData.suggested ?? rawPrice,
                    last_price_update: new Date().toISOString(),
                  })
                  .eq("id", card.id);

                updated++;
              }
            } catch (err) {
              console.error(`Failed to fetch price for ${card.card_name}:`, err);
            }
          })
        );

        setProgress({ processed: Math.min(i + batchSize, cards.length), updated, total: cards.length });
        
        // Small delay between batches to avoid rate limiting
        if (i + batchSize < cards.length) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      toast.success(`Updated prices for ${updated} of ${cards.length} cards`, { id: "bulk-price-refresh" });
      loadMissingPriceCount();
    } catch (err: any) {
      console.error("Bulk price refresh error:", err);
      toast.error("Failed to refresh prices", { id: "bulk-price-refresh" });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-amber-500" />
        <p className="text-sm text-muted-foreground">
          {missingPriceCount > 0
            ? `${missingPriceCount} cards have no price data`
            : "All cards have price data"}
        </p>
      </div>

      {isProcessing && progress.total > 0 && (
        <div className="space-y-2">
          <Progress value={(progress.processed / progress.total) * 100} />
          <p className="text-xs text-muted-foreground">
            Processed {progress.processed} of {progress.total} • Updated {progress.updated}
          </p>
        </div>
      )}

      <Button
        variant="outline"
        onClick={handleBulkRefresh}
        disabled={isProcessing || missingPriceCount === 0}
      >
        {isProcessing ? (
          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <DollarSign className="h-4 w-4 mr-2" />
        )}
        Fetch Missing Prices {missingPriceCount > 0 ? `(${missingPriceCount})` : ""}
      </Button>
    </div>
  );
}
