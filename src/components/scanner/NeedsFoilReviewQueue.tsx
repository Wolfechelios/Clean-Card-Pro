// NeedsFoilReviewQueue — batch review panel for foil scans from rapid mode

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, CheckCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  getFoilReviewQueue,
  markFoilReviewDone,
  removeFoilReviewItem,
  clearReviewedFoilItems,
  type FoilReviewItem,
} from "@/lib/foilTrainer/foilReviewQueueService";
import { FoilCorrectionModal } from "./FoilCorrectionModal";
import { FoilConfidenceBadge } from "./FoilConfidenceBadge";
import { saveFoilCorrection, updateFoilLearningMemory } from "@/lib/foilTrainer/foilCorrectionStore";
import type { FinishType, FoilIssueTag } from "@/lib/foilTrainer/types";

interface NeedsFoilReviewQueueProps {
  userId: string;
}

export function NeedsFoilReviewQueue({ userId }: NeedsFoilReviewQueueProps) {
  const [queue, setQueue] = useState<FoilReviewItem[]>([]);
  const [correctionItem, setCorrectionItem] = useState<FoilReviewItem | null>(null);

  const refresh = useCallback(() => {
    setQueue(getFoilReviewQueue().filter((i) => !i.reviewed));
  }, []);

  useEffect(() => {
    refresh();
    const handler = () => refresh();
    window.addEventListener("foil-review-queue-updated", handler);
    return () => window.removeEventListener("foil-review-queue-updated", handler);
  }, [refresh]);

  const handleConfirm = useCallback(async (item: FoilReviewItem) => {
    await saveFoilCorrection(userId, {
      scanId: item.scanId,
      cardId: item.dbCardId,
      game: item.gameType,
      setName: item.cardSet || undefined,
      cardNumber: item.cardNumber || undefined,
      predictedCardName: item.cardName,
      predictedRarity: item.rarity || undefined,
      predictedFinish: (item.finish as FinishType) || undefined,
      foilConfidence: item.foilConfidence,
      wasCorrect: true,
      issueTags: [],
      originalImageUri: item.imageUrl,
    });

    markFoilReviewDone(item.id);
    toast.success("Confirmed");
    refresh();
  }, [userId, refresh]);

  const handleCorrectionSubmit = useCallback(async (data: {
    correctedFinish: FinishType;
    correctedRarity: string;
    issueTags: FoilIssueTag[];
    note: string;
  }) => {
    if (!correctionItem) return;
    await saveFoilCorrection(userId, {
      scanId: correctionItem.scanId,
      cardId: correctionItem.dbCardId,
      game: correctionItem.gameType,
      setName: correctionItem.cardSet || undefined,
      cardNumber: correctionItem.cardNumber || undefined,
      predictedCardName: correctionItem.cardName,
      predictedRarity: correctionItem.rarity || undefined,
      correctedRarity: data.correctedRarity,
      predictedFinish: (correctionItem.finish as FinishType) || undefined,
      correctedFinish: data.correctedFinish,
      foilConfidence: correctionItem.foilConfidence,
      wasCorrect: false,
      issueTags: data.issueTags,
      originalImageUri: correctionItem.imageUrl,
    });

    const keyValue = correctionItem.cardSet && correctionItem.cardNumber
      ? `${correctionItem.cardSet}|${correctionItem.cardNumber}`
      : correctionItem.cardName.toLowerCase();
    await updateFoilLearningMemory(
      userId,
      correctionItem.cardSet && correctionItem.cardNumber ? "setNumber" : "cardName",
      keyValue,
      correctionItem.gameType,
      data.correctedFinish,
      data.correctedRarity || correctionItem.rarity,
      false,
    );

    markFoilReviewDone(correctionItem.id);
    setCorrectionItem(null);
    toast.success("Correction saved");
    refresh();
  }, [userId, correctionItem, refresh]);

  if (queue.length === 0) return null;

  return (
    <>
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Needs Foil Review
            <Badge variant="secondary">{queue.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3">
          <ScrollArea className="max-h-64">
            <div className="space-y-2">
              {queue.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-2 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  {item.imageUrl && (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="h-12 w-9 rounded border object-cover flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{item.cardName}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {item.cardSet || "Unknown Set"} · {item.finish || "Unknown Finish"}
                    </div>
                    <FoilConfidenceBadge confidence={item.foilConfidence} className="mt-1" />
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button size="icon-sm" variant="ghost" onClick={() => handleConfirm(item)}>
                      <CheckCircle className="h-4 w-4 text-primary" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setCorrectionItem(item)}
                    >
                      <Sparkles className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => {
                        removeFoilReviewItem(item.id);
                        refresh();
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {queue.length > 0 && (
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  clearReviewedFoilItems();
                  refresh();
                }}
              >
                Clear Reviewed
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {correctionItem && (
        <FoilCorrectionModal
          open={!!correctionItem}
          onOpenChange={(open) => !open && setCorrectionItem(null)}
          predictedFinish={correctionItem.finish}
          predictedRarity={correctionItem.rarity}
          onSubmit={handleCorrectionSubmit}
        />
      )}
    </>
  );
}
