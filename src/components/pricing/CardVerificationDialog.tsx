// src/components/pricing/CardVerificationDialog.tsx
// Side-by-side current ↔ verified comparison dialog.

import { useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, RefreshCw, X, AlertTriangle, ImageIcon } from "lucide-react";
import { PriceConsensusPanel } from "./PriceConsensusPanel";
import { useCardVerification } from "@/hooks/use-card-verification";
import type { VerifyCardInput, VerifiedIdentification } from "@/lib/verification/verifyCard";

export interface VerifyAcceptPatch {
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  rarity: string | null;
  game_type: string | null;
  sport_type: string | null;
  current_price_raw: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: VerifyCardInput | null;
  /** Called with the patch to apply when user accepts. */
  onAccept?: (patch: VerifyAcceptPatch, identification: VerifiedIdentification) => void | Promise<void>;
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium truncate">{value ?? <span className="text-muted-foreground italic">—</span>}</div>
    </div>
  );
}

export function CardVerificationDialog({ open, onOpenChange, card, onAccept }: Props) {
  const { result, loading, error, run, reset } = useCardVerification();

  useEffect(() => {
    if (open && card) {
      run(card, false);
    }
    if (!open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, card?.id, card?.imageUrl]);

  const handleRerun = () => {
    if (card) run(card, true);
  };

  const handleAccept = async () => {
    if (!card || !result) return;
    const { identification, consensus } = result;
    // Always persist verified identity. If price flagged as needsReview, keep existing price.
    const priceToWrite = result.needsReview
      ? (typeof card.id === "string" ? NaN : NaN) // sentinel: caller should ignore price
      : consensus.recommendedUSD;
    await onAccept?.(
      {
        card_name: identification.cardName,
        card_set: identification.cardSet,
        card_number: identification.cardNumber,
        rarity: identification.rarity,
        game_type: identification.gameType,
        sport_type: identification.sportType,
        current_price_raw: Number.isFinite(priceToWrite) ? priceToWrite : 0,
      },
      identification
    );
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Verify Card
          </DialogTitle>
          <DialogDescription>
            Re-runs identification and pulls a fresh price consensus across all sources. Each verification ≈ up to 6 API calls.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Current */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Current</span>
              <Badge variant="outline" className="text-[10px]">On record</Badge>
            </div>
            <div className="aspect-[3/4] w-full overflow-hidden rounded-md border border-border/50 bg-muted">
              {card?.imageUrl ? (
                <img src={card.imageUrl} alt="Current card" className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <ImageIcon className="h-8 w-8" />
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Name" value={card?.cardName} />
              <Field label="Set" value={card?.cardSet} />
              <Field label="Number" value={card?.cardNumber} />
              <Field label="Rarity" value={card?.rarity} />
              <Field label="Game" value={card?.gameType} />
              <Field label="Condition" value={card?.condition} />
            </div>
          </div>

          {/* Verified */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Verified Match</span>
              {result?.needsReview && (
                <Badge variant="destructive" className="text-[10px] gap-1">
                  <AlertTriangle className="h-3 w-3" /> Needs review
                </Badge>
              )}
            </div>

            {loading && (
              <div className="space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-24 w-full" />
              </div>
            )}

            {error && !loading && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {!loading && !error && result && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Name" value={result.identification.cardName} />
                  <Field label="Set" value={result.identification.cardSet} />
                  <Field label="Number" value={result.identification.cardNumber} />
                  <Field label="Rarity" value={result.identification.rarity} />
                  <Field label="Game" value={result.identification.gameType} />
                  <Field label="Match" value={`${Math.round(result.identification.matchConfidence * 100)}%`} />
                </div>
                <PriceConsensusPanel
                  consensus={result.consensus}
                  needsReview={result.needsReview}
                />
              </>
            )}
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-2" />
            Reject
          </Button>
          <Button variant="outline" onClick={handleRerun} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Re-run
          </Button>
          <Button
            variant="default"
            onClick={handleAccept}
            disabled={loading || !result}
            title={result?.needsReview ? "Anomaly detected — accepting will still save the verified identity but flag the price." : undefined}
          >
            <ShieldCheck className="h-4 w-4 mr-2" />
            {result?.needsReview ? "Accept Anyway" : "Accept Verified"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
