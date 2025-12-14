import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ImageIcon, CheckCircle2, AlertCircle, Download } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

interface BulkImageLookupProps {
  onComplete?: () => void;
}

export function BulkImageLookup({ onComplete }: BulkImageLookupProps) {
  const { userId } = useAuth();
  const [placeholderCount, setPlaceholderCount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [updated, setUpdated] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadPlaceholderCount();
  }, [userId]);

  const loadPlaceholderCount = async () => {
    if (!userId) {
      setIsLoading(false);
      return;
    }

    try {
      // Get cards with placeholder images
      const { data, error } = await supabase
        .from("cards")
        .select("id")
        .eq("user_id", userId)
        .like("image_url", "%placehold%");

      if (error) throw error;
      setPlaceholderCount(data?.length || 0);
    } catch (error) {
      console.error("Error loading placeholder count:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBulkLookup = async () => {
    if (!userId || placeholderCount === 0) {
      toast.info("No cards with placeholder images to process");
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setProcessed(0);
    setUpdated(0);

    const batchSize = 10;
    let totalProcessed = 0;
    let totalUpdated = 0;

    try {
      // Fetch all cards with placeholder images
      const { data: cards, error } = await supabase
        .from("cards")
        .select("id, card_name, card_set, game_type, sport_type")
        .eq("user_id", userId)
        .like("image_url", "%placehold%");

      if (error) throw error;
      if (!cards || cards.length === 0) {
        toast.info("No cards with placeholder images found");
        setIsProcessing(false);
        return;
      }

      const total = cards.length;

      // Process in batches
      for (let i = 0; i < cards.length; i += batchSize) {
        const batch = cards.slice(i, i + batchSize);
        
        // Process batch concurrently
        const results = await Promise.allSettled(
          batch.map(async (card) => {
            try {
              const { data, error } = await supabase.functions.invoke("generate-card-image-url", {
                body: {
                  cardName: card.card_name,
                  cardSet: card.card_set,
                  gameType: card.game_type || card.sport_type,
                },
              });

              if (error) throw error;

              if (data?.imageUrl && !data.imageUrl.includes("placehold")) {
                // Update the card with the new image URL
                const { error: updateError } = await supabase
                  .from("cards")
                  .update({ 
                    image_url: data.imageUrl,
                    updated_at: new Date().toISOString() 
                  })
                  .eq("id", card.id);

                if (updateError) throw updateError;
                return { success: true, updated: true };
              }
              
              return { success: true, updated: false };
            } catch (err) {
              console.error(`Error processing card ${card.card_name}:`, err);
              return { success: false, updated: false };
            }
          })
        );

        // Count results
        results.forEach((result) => {
          if (result.status === "fulfilled" && result.value.updated) {
            totalUpdated++;
          }
        });

        totalProcessed += batch.length;
        setProcessed(totalProcessed);
        setUpdated(totalUpdated);
        setProgress(Math.round((totalProcessed / total) * 100));

        // Small delay between batches to avoid rate limiting
        if (i + batchSize < cards.length) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      toast.success(`Completed! Found images for ${totalUpdated} of ${totalProcessed} cards`);
      loadPlaceholderCount();
      onComplete?.();
    } catch (error: any) {
      console.error("Bulk lookup error:", error);
      toast.error(error.message || "Error during image lookup");
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            Loading...
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (placeholderCount === 0) {
    return (
      <Card className="border-success/20 bg-success/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            All Cards Have Images
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
          Missing Card Images
        </CardTitle>
        <CardDescription>
          {placeholderCount.toLocaleString()} cards have placeholder images
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isProcessing ? (
          <div className="space-y-3">
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Processing... {processed} cards checked</span>
              <span>{updated} images found</span>
            </div>
          </div>
        ) : (
          <Button
            onClick={handleBulkLookup}
            className="w-full"
            variant="outline"
          >
            <Download className="h-4 w-4 mr-2" />
            Fetch Images for {placeholderCount.toLocaleString()} Cards
          </Button>
        )}
        <p className="text-xs text-muted-foreground">
          Looks up card images from online databases. This may take several minutes for large collections.
        </p>
      </CardContent>
    </Card>
  );
}
