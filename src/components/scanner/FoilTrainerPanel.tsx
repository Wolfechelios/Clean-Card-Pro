// FoilTrainerPanel — compact post-scan foil correction module
// Shows predicted finish/rarity, foil confidence, and correction buttons.
// Only renders when shouldShowFoilTrainer returns a non-"none" level.

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Edit2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { FoilConfidenceBadge } from "./FoilConfidenceBadge";
import { FoilCorrectionModal } from "./FoilCorrectionModal";
import type { FinishType, FoilIssueTag, FoilScanResult } from "@/lib/foilTrainer/types";
import { saveFoilCorrection, updateFoilLearningMemory } from "@/lib/foilTrainer/foilCorrectionStore";
import { reconditionFoilImage } from "@/lib/foilTrainer/foilReconditionService";
import type { FoilTrainerTriggerLevel } from "@/lib/foilTrainer/foilTrainerService";

interface FoilTrainerPanelProps {
  userId: string;
  scanId: string;
  cardName: string;
  cardSet: string | null;
  cardNumber: string | null;
  rarity: string | null;
  gameType: string | null;
  foilResult: FoilScanResult;
  triggerLevel: FoilTrainerTriggerLevel;
  imageUrl?: string;
  cardId?: string;
  onReconditionComplete?: (newImageUrl: string) => void;
  onCorrectionSaved?: () => void;
}

export function FoilTrainerPanel({
  userId,
  scanId,
  cardName,
  cardSet,
  cardNumber,
  rarity,
  gameType,
  foilResult,
  triggerLevel,
  imageUrl,
  cardId,
  onReconditionComplete,
  onCorrectionSaved,
}: FoilTrainerPanelProps) {
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [isReconditioning, setIsReconditioning] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const handleCorrect = useCallback(async () => {
    // Save as "correct"
    await saveFoilCorrection(userId, {
      scanId,
      cardId,
      game: gameType,
      setName: cardSet || undefined,
      cardNumber: cardNumber || undefined,
      predictedCardName: cardName,
      predictedRarity: rarity || undefined,
      predictedFinish: foilResult.finish,
      foilConfidence: foilResult.foilConfidence,
      parallelConfidence: foilResult.parallelConfidence,
      wasCorrect: true,
      issueTags: [],
      originalImageUri: imageUrl,
    });

    // Update learning memory
    const keyValue = cardSet && cardNumber
      ? `${cardSet}|${cardNumber}`
      : cardName.toLowerCase();
    await updateFoilLearningMemory(
      userId,
      cardSet && cardNumber ? "setNumber" : "cardName",
      keyValue,
      gameType,
      foilResult.finish,
      rarity,
      true,
    );

    setConfirmed(true);
    toast.success("Foil classification confirmed!");
    onCorrectionSaved?.();
  }, [userId, scanId, cardId, gameType, cardSet, cardNumber, cardName, rarity, foilResult, imageUrl, onCorrectionSaved]);

  const handleCorrectionSubmit = useCallback(async (data: {
    correctedFinish: FinishType;
    correctedRarity: string;
    issueTags: FoilIssueTag[];
    note: string;
  }) => {
    await saveFoilCorrection(userId, {
      scanId,
      cardId,
      game: gameType,
      setName: cardSet || undefined,
      cardNumber: cardNumber || undefined,
      predictedCardName: cardName,
      predictedRarity: rarity || undefined,
      correctedRarity: data.correctedRarity || undefined,
      predictedFinish: foilResult.finish,
      correctedFinish: data.correctedFinish,
      foilConfidence: foilResult.foilConfidence,
      parallelConfidence: foilResult.parallelConfidence,
      wasCorrect: false,
      issueTags: data.issueTags,
      originalImageUri: imageUrl,
    });

    const keyValue = cardSet && cardNumber
      ? `${cardSet}|${cardNumber}`
      : cardName.toLowerCase();
    await updateFoilLearningMemory(
      userId,
      cardSet && cardNumber ? "setNumber" : "cardName",
      keyValue,
      gameType,
      data.correctedFinish,
      data.correctedRarity || rarity,
      false,
    );

    setConfirmed(true);
    toast.success("Foil correction saved! This will improve future scans.");
    onCorrectionSaved?.();
  }, [userId, scanId, cardId, gameType, cardSet, cardNumber, cardName, rarity, foilResult, imageUrl, onCorrectionSaved]);

  const handleRetakeFoilScan = useCallback(async () => {
    if (!imageUrl) return;
    setIsReconditioning(true);
    try {
      const result = await reconditionFoilImage(imageUrl);
      if (result.improvements.length > 0) {
        toast.success(`Image reconditioned: ${result.improvements.join(", ")}`);
        onReconditionComplete?.(result.reconditionedDataUrl);
      } else {
        toast.info("No reconditioning improvements found");
      }
    } catch (e) {
      console.error("Reconditioning error:", e);
      toast.error("Failed to recondition image");
    } finally {
      setIsReconditioning(false);
    }
  }, [imageUrl, onReconditionComplete]);

  if (confirmed) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-lg border border-primary/20 bg-primary/5">
        <CheckCircle className="h-4 w-4 text-primary" />
        <span className="text-sm text-primary">Foil classification saved</span>
      </div>
    );
  }

  const isSubtle = triggerLevel === "subtle";

  return (
    <>
      <Card className={isSubtle ? "border-border/40" : "border-yellow-500/40 bg-yellow-500/5"}>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Foil Trainer
            <FoilConfidenceBadge confidence={foilResult.foilConfidence} />
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-3 space-y-3">
          {/* Predicted info */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Finish:</span>{" "}
              <span className="font-medium">{foilResult.finish}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Rarity:</span>{" "}
              <span className="font-medium">{rarity || "Unknown"}</span>
            </div>
          </div>

          {triggerLevel === "prominent" && (
            <p className="text-xs text-yellow-600 dark:text-yellow-400">
              Unsure about foil/rarity. Please verify or correct.
            </p>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="default" onClick={handleCorrect}>
              <CheckCircle className="h-3.5 w-3.5 mr-1" />
              Correct
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setCorrectionOpen(true)}>
              <Edit2 className="h-3.5 w-3.5 mr-1" />
              Fix Finish / Rarity
            </Button>
            {imageUrl && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRetakeFoilScan}
                disabled={isReconditioning}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isReconditioning ? "animate-spin" : ""}`} />
                Retake Foil Scan
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <FoilCorrectionModal
        open={correctionOpen}
        onOpenChange={setCorrectionOpen}
        predictedFinish={foilResult.finish}
        predictedRarity={rarity}
        onSubmit={handleCorrectionSubmit}
      />
    </>
  );
}
