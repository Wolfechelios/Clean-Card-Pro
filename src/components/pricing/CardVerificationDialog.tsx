// src/components/pricing/CardVerificationDialog.tsx
// Side-by-side current ↔ verified comparison dialog with selectable candidates
// and a verified reference image.

import { useEffect, useState } from "react";
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
import { ShieldCheck, RefreshCw, X, AlertTriangle, ImageIcon, Loader2, CheckCircle2, Sparkles } from "lucide-react";
import { PriceConsensusPanel } from "./PriceConsensusPanel";
import { useCardVerification } from "@/hooks/use-card-verification";
import type { VerifyCardInput, VerifiedIdentification } from "@/lib/verification/verifyCard";
import { MtgEditionFinder, type MtgEditionSelection } from "@/components/mtg/MtgEditionFinder";
import { cn } from "@/lib/utils";

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
      <div className="text-sm font-medium truncate">
        {value ?? <span className="text-muted-foreground italic">—</span>}
      </div>
    </div>
  );
}

export function CardVerificationDialog({ open, onOpenChange, card, onAccept }: Props) {
  const {
    result,
    selected,
    selectedIndex,
    loading,
    switching,
    error,
    run,
    selectCandidate,
    reset,
  } = useCardVerification();

  const [showEditionFinder, setShowEditionFinder] = useState(false);
  const [overridePatch, setOverridePatch] = useState<MtgEditionSelection | null>(null);

  useEffect(() => {
    if (open && card) {
      run(card, false);
      setOverridePatch(null);
    }
    if (!open) {
      reset();
      setOverridePatch(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, card?.id, card?.imageUrl]);

  const handleRerun = () => {
    if (card) run(card, true);
  };

  const isMtg = (selected?.gameType || card?.gameType || "").toLowerCase().includes("mtg") ||
    (selected?.gameType || card?.gameType || "").toLowerCase().includes("magic");

  const handleAccept = async () => {
    if (!card || !result || !selected) return;
    const { consensus, needsReview } = result;
    // If user picked an MTG edition override, prefer that data + price.
    const finalName = overridePatch?.cardName || selected.cardName;
    const finalSet = overridePatch?.setName || selected.cardSet;
    const finalNumber = overridePatch?.collectorNumber || selected.cardNumber;
    const finalRarity = overridePatch?.rarity || selected.rarity;
    const overridePrice = overridePatch?.priceUsd ?? null;
    const finalPrice = overridePrice !== null && overridePrice > 0
      ? overridePrice
      : (needsReview ? 0 : consensus.recommendedUSD);
    await onAccept?.(
      {
        card_name: finalName,
        card_set: finalSet,
        card_number: finalNumber,
        rarity: finalRarity,
        game_type: selected.gameType,
        sport_type: selected.sportType,
        current_price_raw: finalPrice,
      },
      selected
    );
    onOpenChange(false);
  };

  const referenceImageUrl = result?.referenceImageUrl ?? null;
  const candidates = result?.candidates ?? [];
  const hasAlternatives = candidates.length > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Verify Card
          </DialogTitle>
          <DialogDescription>
            Re-runs identification, fetches the matching reference card, and pulls a fresh price consensus.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Current */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Your Card</span>
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
              <div className="flex items-center gap-1.5">
                {switching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                {result?.needsReview && (
                  <Badge variant="destructive" className="text-[10px] gap-1">
                    <AlertTriangle className="h-3 w-3" /> Needs review
                  </Badge>
                )}
              </div>
            </div>

            {/* Reference image for selected candidate */}
            <div className="aspect-[3/4] w-full overflow-hidden rounded-md border border-border/50 bg-muted">
              {loading ? (
                <Skeleton className="w-full h-full" />
              ) : referenceImageUrl ? (
                <img
                  src={referenceImageUrl}
                  alt="Verified reference card"
                  className="w-full h-full object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground gap-1">
                  <ImageIcon className="h-8 w-8" />
                  <span className="text-[10px]">No reference image found</span>
                </div>
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

            {!loading && !error && result && selected && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Name" value={selected.cardName} />
                  <Field label="Set" value={selected.cardSet} />
                  <Field label="Number" value={selected.cardNumber} />
                  <Field label="Rarity" value={selected.rarity} />
                  <Field label="Game" value={selected.gameType} />
                  <Field
                    label="Match"
                    value={`${Math.round(selected.matchConfidence * 100)}%`}
                  />
                </div>
                <PriceConsensusPanel
                  consensus={result.consensus}
                  loading={switching}
                  needsReview={result.needsReview}
                />
              </>
            )}
          </div>
        </div>

        {/* Alternative matches */}
        {hasAlternatives && !loading && !error && (
          <div className="space-y-2 pt-2 border-t border-border/50">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Alternative matches
              </span>
              <Badge variant="outline" className="text-[10px]">
                {candidates.length - 1} other{candidates.length - 1 === 1 ? "" : "s"}
              </Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {candidates.map((c, i) => {
                const isSelected = i === selectedIndex;
                return (
                  <button
                    key={`${c.cardName}-${c.cardSet ?? "noset"}-${i}`}
                    type="button"
                    onClick={() => selectCandidate(i)}
                    disabled={switching || isSelected}
                    className={cn(
                      "text-left rounded-md border p-2.5 transition-all",
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border bg-card hover:bg-accent/50 hover:border-primary/30",
                      switching && "opacity-50 cursor-wait"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {isSelected && <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />}
                          <p className="text-xs font-semibold truncate">{c.cardName}</p>
                        </div>
                        {c.cardSet && (
                          <p className="text-[10px] text-muted-foreground truncate">
                            {c.cardSet}
                            {c.cardNumber && ` • #${c.cardNumber}`}
                          </p>
                        )}
                        {c.reason && (
                          <p className="text-[10px] text-muted-foreground/80 truncate mt-0.5 italic">
                            {c.reason}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className="text-[9px] shrink-0">
                        {Math.round(c.matchConfidence * 100)}%
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Tap an alternative to re-price and re-fetch its reference image.
            </p>
          </div>
        )}

        {isMtg && !loading && (selected || card) && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs space-y-2">
            <div className="flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-foreground">MTG Edition Finder</p>
                <p className="text-muted-foreground">
                  Browse every printing of this card (including Alpha, Beta, Unlimited, Revised) to confirm the exact edition and price.
                </p>
                {overridePatch && (
                  <p className="mt-1 text-foreground">
                    Selected override: <span className="font-semibold">{overridePatch.setName}</span>
                    {overridePatch.year && <> ({overridePatch.year})</>}
                    {overridePatch.priceUsd !== null && <> — ${overridePatch.priceUsd.toFixed(2)}</>}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowEditionFinder(true)}
              >
                Find Edition
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-2" />
            Reject
          </Button>
          <Button variant="outline" onClick={handleRerun} disabled={loading || switching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Re-run
          </Button>
          <Button
            variant="default"
            onClick={handleAccept}
            disabled={loading || switching || !result || !selected}
            title={result?.needsReview ? "Anomaly detected — accepting will save the verified identity but flag the price." : undefined}
          >
            <ShieldCheck className="h-4 w-4 mr-2" />
            {overridePatch ? "Accept Edition" : result?.needsReview ? "Accept Anyway" : "Accept Verified"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <MtgEditionFinder
        open={showEditionFinder}
        onOpenChange={setShowEditionFinder}
        initialCardName={selected?.cardName || card?.cardName || null}
        initialSetCode={null}
        onSelect={(picked) => {
          setOverridePatch(picked);
        }}
      />
    </Dialog>
  );
}
