import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchCardPrices } from "@/lib/fetchCardPrices";
import { toPublicImageUrl } from "@/lib/storage/getPublicImageUrl";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Loader2, CheckCircle2, Sparkles, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";

type Candidate = {
  id: string;
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  rarity: string | null;
  market_price: number | null;
  psa10_price?: number | null;
  image_url?: string | null;
  confidence?: number | null;
  source?: string;
};

export type VerifyTarget = {
  cardName?: string;
  cardSet?: string | null;
  cardNumber?: string | null;
  rarity?: string | null;
  value?: number | null;
  psa10Price?: number | null;
  imageUrl?: string | null;
  preview?: string | null;
  gameType?: string | null;
  sportType?: string | null;
};

export type VerifyApplyPayload = {
  cardName: string;
  cardSet: string | null;
  cardNumber: string | null;
  rarity: string | null;
  value: number | null;
  psa10Price: number | null;
  imageUrl?: string | null;
  matchConfidence?: number | null;
};

interface CardVerifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: VerifyTarget | null;
  title?: string;
  onApply: (payload: VerifyApplyPayload) => Promise<void> | void;
}

export function CardVerifyDialog({
  open,
  onOpenChange,
  card,
  title = "Verify card",
  onApply,
}: CardVerifyDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);

  useEffect(() => {
    if (!open || !card) return;
    const initial = [card.cardName, card.cardSet, card.cardNumber].filter(Boolean).join(" ").trim();
    setSearchQuery(initial || card.cardName || "");
    setCandidates([]);
    setSelected(null);
  }, [open, card]);

  const enrichedSelected = useMemo(() => {
    if (!selected) return null;
    return {
      ...selected,
      priceDelta: (selected.market_price ?? 0) - (card?.value ?? 0),
      sameSet: normalize(selected.card_set) === normalize(card?.cardSet),
      sameNumber: normalize(selected.card_number) === normalize(card?.cardNumber),
      sameName: normalize(selected.card_name) === normalize(card?.cardName),
    };
  }, [selected, card]);

  const runSearch = useCallback(async () => {
    if (!card) return;
    const q = searchQuery.trim() || card.cardName || "";
    if (!q) {
      toast.error("No search text available for verification");
      return;
    }

    setIsSearching(true);
    setCandidates([]);
    setSelected(null);

    try {
      const { data, error } = await supabase.functions.invoke("search-card-details", {
        body: {
          card_name: q,
          game_type: card.gameType || card.sportType || "yugioh",
        },
      });

      if (error) throw error;

      const rawMatches = Array.isArray(data?.matches) ? data.matches : [];
      const topMatches = rawMatches.slice(0, 5);

      const enriched = await Promise.all(
        topMatches.map(async (match: any, index: number) => {
          let image_url: string | null = null;
          let market_price = match.market_price ?? null;
          let psa10_price: number | null = null;

          try {
            const [imageRes, priceRes] = await Promise.allSettled([
              supabase.functions.invoke("generate-card-image-url", {
                body: {
                  cardName: match.card_name,
                  cardSet: match.card_set,
                  gameType: card.gameType || card.sportType,
                },
              }),
              fetchCardPrices(
                match.card_name,
                match.card_set,
                match.card_number,
                card.gameType,
                card.sportType,
                null
              ),
            ]);

            if (imageRes.status === "fulfilled" && imageRes.value?.data?.imageUrl) {
              image_url = imageRes.value.data.imageUrl;
            }

            if (priceRes.status === "fulfilled") {
              market_price = priceRes.value.price ?? priceRes.value.marketPrice ?? market_price ?? null;
              psa10_price = priceRes.value.psa10Price ?? null;
            }
          } catch {
            // keep partial results
          }

          return {
            id: `${match.card_name}-${match.card_set || "na"}-${match.card_number || index}`,
            card_name: match.card_name,
            card_set: match.card_set ?? null,
            card_number: match.card_number ?? null,
            rarity: match.rarity ?? null,
            market_price,
            psa10_price,
            image_url,
            confidence: scoreCandidate(match, card, index),
            source: "lookup",
          } satisfies Candidate;
        })
      );

      setCandidates(enriched);
      if (enriched.length > 0) setSelected(enriched[0]);
      else toast.info("No verification matches returned");
    } catch (error) {
      console.error("Verification search failed:", error);
      toast.error("Failed to verify this card");
    } finally {
      setIsSearching(false);
    }
  }, [card, searchQuery]);

  useEffect(() => {
    if (open && card) {
      runSearch();
    }
  }, [open, card, runSearch]);

  const handleApply = useCallback(async () => {
    if (!selected) return;
    setIsApplying(true);
    try {
      await onApply({
        cardName: selected.card_name,
        cardSet: selected.card_set,
        cardNumber: selected.card_number,
        rarity: selected.rarity,
        value: selected.market_price ?? null,
        psa10Price: selected.psa10_price ?? null,
        imageUrl: selected.image_url ?? null,
        matchConfidence: selected.confidence ?? null,
      });
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to apply verified card:", error);
      toast.error("Failed to apply verified card");
    } finally {
      setIsApplying(false);
    }
  }, [selected, onApply, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>
            Pull the closest match, compare live value, and replace the scan with the verified card.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start overflow-hidden">
          <div className="lg:w-[300px] shrink-0 space-y-3">
            <div className="flex gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder="Search this card"
              />
              <Button onClick={runSearch} disabled={isSearching} size="sm" className="gap-1">
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Search
              </Button>
            </div>

            <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current card</div>
              <div className="aspect-[3/4] overflow-hidden rounded-md border bg-background">
                {card?.imageUrl || card?.preview ? (
                  <img
                    src={card?.imageUrl ? toPublicImageUrl(card.imageUrl) : card?.preview || undefined}
                    alt={card?.cardName || "Scanned card"}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">No image</div>
                )}
              </div>
              <div className="space-y-1 text-sm">
                <div className="font-semibold line-clamp-2">{card?.cardName || "Unknown Card"}</div>
                <div className="text-muted-foreground line-clamp-1">{card?.cardSet || "Unknown set"}</div>
                <div className="text-muted-foreground">#{card?.cardNumber || "—"}</div>
                <div className="flex flex-wrap gap-1">
                  {card?.rarity ? <Badge variant="secondary">{card.rarity}</Badge> : null}
                  {typeof card?.value === "number" && card.value > 0 ? <Badge variant="outline">Raw ${card.value.toFixed(2)}</Badge> : null}
                  {typeof card?.psa10Price === "number" && card.psa10Price > 0 ? <Badge variant="outline">PSA 10 ${card.psa10Price.toFixed(2)}</Badge> : null}
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 min-w-0 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] overflow-hidden">
            <ScrollArea className="h-[58vh] rounded-lg border">
              <div className="p-3 space-y-3">
                {isSearching && candidates.length === 0 ? (
                  Array.from({ length: 3 }).map((_, idx) => (
                    <div key={idx} className="rounded-lg border p-3 space-y-2">
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-24 w-full" />
                    </div>
                  ))
                ) : candidates.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground text-center">
                    No match candidates yet.
                  </div>
                ) : (
                  candidates.map((candidate) => {
                    const isActive = selected?.id === candidate.id;
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => setSelected(candidate)}
                        className={`w-full rounded-lg border p-3 text-left transition ${
                          isActive ? "border-primary bg-primary/5 shadow-sm" : "hover:bg-muted/40"
                        }`}
                      >
                        <div className="flex gap-3">
                          <div className="h-24 w-16 shrink-0 overflow-hidden rounded-md border bg-background">
                            {candidate.image_url ? (
                              <img src={candidate.image_url} alt={candidate.card_name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="h-full w-full flex items-center justify-center text-[10px] text-muted-foreground">No image</div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-semibold line-clamp-2">{candidate.card_name}</div>
                                <div className="text-xs text-muted-foreground line-clamp-1">{candidate.card_set || "Unknown set"}</div>
                              </div>
                              <Badge variant={isActive ? "default" : "outline"}>
                                {Math.round(candidate.confidence ?? 0)}%
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {candidate.card_number ? <Badge variant="outline">#{candidate.card_number}</Badge> : null}
                              {candidate.rarity ? <Badge variant="secondary">{candidate.rarity}</Badge> : null}
                              {typeof candidate.market_price === "number" && candidate.market_price > 0 ? (
                                <Badge variant="outline">Raw ${candidate.market_price.toFixed(2)}</Badge>
                              ) : null}
                              {typeof candidate.psa10_price === "number" && candidate.psa10_price > 0 ? (
                                <Badge variant="outline">PSA 10 ${candidate.psa10_price.toFixed(2)}</Badge>
                              ) : null}
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-2 pt-1">
                              <Sparkles className="h-3 w-3" />
                              Best fit is based on name, set, number, and live lookup alignment.
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>

            <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ArrowRightLeft className="h-4 w-4" />
                Compare
              </div>

              {!enrichedSelected ? (
                <div className="text-sm text-muted-foreground">Select a candidate to compare.</div>
              ) : (
                <>
                  <div className="aspect-[3/4] overflow-hidden rounded-md border bg-background">
                    {enrichedSelected.image_url ? (
                      <img src={enrichedSelected.image_url} alt={enrichedSelected.card_name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground">No reference image</div>
                    )}
                  </div>

                  <div className="space-y-2 text-sm">
                    <Row label="Matched name" value={enrichedSelected.card_name} good={enrichedSelected.sameName} />
                    <Row label="Matched set" value={enrichedSelected.card_set || "—"} good={enrichedSelected.sameSet} />
                    <Row label="Matched #" value={enrichedSelected.card_number || "—"} good={enrichedSelected.sameNumber} />
                    <Row label="Rarity" value={enrichedSelected.rarity || "—"} />
                    <Row label="Raw value" value={money(enrichedSelected.market_price)} />
                    <Row label="PSA 10" value={money(enrichedSelected.psa10_price)} />
                    <Row
                      label="Price delta"
                      value={formatDelta(enrichedSelected.priceDelta)}
                      good={typeof enrichedSelected.priceDelta === "number" ? enrichedSelected.priceDelta >= 0 : undefined}
                    />
                    <Row label="Confidence" value={`${Math.round(enrichedSelected.confidence ?? 0)}%`} />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={!selected || isApplying} className="gap-2">
            {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Apply verified match
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function normalize(value?: string | null) {
  return (value || "").trim().toLowerCase();
}

function money(value?: number | null) {
  return typeof value === "number" && value > 0 ? `$${value.toFixed(2)}` : "—";
}

function formatDelta(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}$${value.toFixed(2)}`;
}

function scoreCandidate(match: any, current: VerifyTarget, index: number) {
  let score = 62 - index * 4;
  if (normalize(match.card_name) === normalize(current.cardName)) score += 18;
  if (normalize(match.card_set) === normalize(current.cardSet)) score += 10;
  if (normalize(match.card_number) === normalize(current.cardNumber)) score += 8;
  if (match.market_price && current.value && Math.abs(match.market_price - current.value) < Math.max(2, current.value * 0.2)) score += 5;
  return Math.max(35, Math.min(99, score));
}

function Row({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-background/80 px-3 py-2">
      <div className="text-muted-foreground">{label}</div>
      <div className={good === true ? "font-medium text-emerald-600" : good === false ? "font-medium text-amber-600" : "font-medium"}>
        {value}
      </div>
    </div>
  );
}
