// MTG Edition Finder — manual printing picker dialog.
// Lists every printing of a card from Scryfall with prices and a vintage badge
// for Alpha/Beta/Unlimited/Revised/4ED/5ED.

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Sparkles, ImageIcon, Crown, CheckCircle2, AlertCircle } from "lucide-react";
import { findMtgEditions, type MtgPrinting } from "@/lib/mtg/editionFinder";
import { cn } from "@/lib/utils";

export interface MtgEditionSelection {
  cardName: string;
  setCode: string;
  setName: string;
  collectorNumber: string | null;
  year: number | null;
  rarity: string | null;
  borderColor: string | null;
  priceUsd: number | null;
  priceFoilUsd: number | null;
  imageUrl: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCardName?: string | null;
  initialYear?: number | null;
  initialSetCode?: string | null;
  onSelect: (selection: MtgEditionSelection) => void | Promise<void>;
}

function fmtPrice(n: number | null): string {
  if (n === null || n === undefined) return "—";
  return `$${n.toFixed(2)}`;
}

export function MtgEditionFinder({
  open,
  onOpenChange,
  initialCardName,
  initialYear,
  initialSetCode,
  onSelect,
}: Props) {
  const [name, setName] = useState(initialCardName ?? "");
  const [printings, setPrintings] = useState<MtgPrinting[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(initialCardName ?? "");
      setPrintings([]);
      setError(null);
      setSelectedId(null);
      if (initialCardName && initialCardName.trim().length > 0) {
        void runSearch(initialCardName.trim());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCardName]);

  async function runSearch(q: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await findMtgEditions(q, {
        hintYear: initialYear ?? undefined,
        hintSetCode: initialSetCode ?? undefined,
      });
      if (!res.success) {
        setError(res.error || "No results");
        setPrintings([]);
      } else {
        setPrintings(res.printings ?? []);
        if (res.bestMatch) setSelectedId(res.bestMatch.scryfall_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  const earlyCount = useMemo(
    () => printings.filter((p) => p.is_early_set).length,
    [printings],
  );

  function handlePick(p: MtgPrinting) {
    setSelectedId(p.scryfall_id);
    void onSelect({
      cardName: name.trim(),
      setCode: p.set_code,
      setName: p.set_name,
      collectorNumber: p.collector_number,
      year: p.year,
      rarity: p.rarity,
      borderColor: p.border_color,
      priceUsd: p.prices.usd,
      priceFoilUsd: p.prices.usd_foil,
      imageUrl: p.image_uri,
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            MTG Edition Finder
          </DialogTitle>
          <DialogDescription>
            Browse every printing of an MTG card. Vintage sets (Alpha, Beta, Unlimited, Revised, 4ED, 5ED) are highlighted.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Card name (e.g. Black Lotus)"
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) void runSearch(name.trim());
            }}
          />
          <Button onClick={() => name.trim() && runSearch(name.trim())} disabled={loading}>
            <Search className="h-4 w-4 mr-2" />
            Search
          </Button>
        </div>

        {earlyCount > 0 && !loading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Crown className="h-3.5 w-3.5 text-amber-500" />
            {earlyCount} vintage printing{earlyCount === 1 ? "" : "s"} found
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <ScrollArea className="flex-1 -mx-2 px-2">
          <div className="space-y-2 py-1">
            {loading &&
              Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}

            {!loading && printings.length === 0 && !error && name.trim() && (
              <div className="text-sm text-muted-foreground text-center py-8">
                No printings to show. Try a different spelling.
              </div>
            )}

            {!loading &&
              printings.map((p) => {
                const isSelected = selectedId === p.scryfall_id;
                return (
                  <button
                    key={p.scryfall_id}
                    type="button"
                    onClick={() => handlePick(p)}
                    className={cn(
                      "w-full text-left rounded-lg border p-3 transition-all flex gap-3 items-start",
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border bg-card hover:bg-accent/50 hover:border-primary/40",
                      p.is_early_set && "ring-1 ring-amber-500/40",
                    )}
                  >
                    <div className="w-16 h-22 shrink-0 rounded-md overflow-hidden border border-border/50 bg-muted">
                      {p.image_uri ? (
                        <img
                          src={p.image_uri}
                          alt={`${p.set_name}`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                          <ImageIcon className="h-5 w-5" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
                        <span className="font-semibold text-sm truncate">{p.set_name}</span>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {p.set_code}
                        </Badge>
                        {p.is_early_set && (
                          <Badge className="text-[10px] bg-amber-500/15 text-amber-600 hover:bg-amber-500/20 border border-amber-500/30 gap-1">
                            <Crown className="h-3 w-3" />
                            {p.early_label ?? "Vintage"}
                          </Badge>
                        )}
                      </div>

                      <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                        {p.year && <span>{p.year}</span>}
                        {p.collector_number && <span>#{p.collector_number}</span>}
                        {p.rarity && <span className="capitalize">{p.rarity}</span>}
                        {p.border_color && (
                          <span className="flex items-center gap-1">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full border border-border"
                              style={{ backgroundColor: p.border_color === "white" ? "#fff" : p.border_color === "black" ? "#000" : p.border_color }}
                            />
                            {p.border_color}
                          </span>
                        )}
                        {p.frame && <span>{p.frame}</span>}
                      </div>

                      <div className="flex items-center gap-3 text-xs">
                        <span className="font-mono">
                          Raw: <span className="font-semibold text-foreground">{fmtPrice(p.prices.usd)}</span>
                        </span>
                        {p.prices.usd_foil !== null && (
                          <span className="font-mono text-muted-foreground">
                            Foil: <span className="font-semibold">{fmtPrice(p.prices.usd_foil)}</span>
                          </span>
                        )}
                        {p.prices.usd_etched !== null && (
                          <span className="font-mono text-muted-foreground">
                            Etched: <span className="font-semibold">{fmtPrice(p.prices.usd_etched)}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
