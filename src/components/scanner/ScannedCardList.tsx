import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Loader2, Plus, Trash2 } from "lucide-react";

export type ScannedCardListItem = {
  id: string;
  preview: string;
  status: "queued" | "uploading" | "processing" | "completed" | "error";
  cardName?: string;
  cardSet?: string;
  cardNumber?: string;
  rarity?: string;
  value?: number | null;
  isInLibrary?: boolean;
  libraryQuantity?: number;
  error?: string;
  priceFetching?: boolean;
  dbId?: string;
  imageUrl?: string;
};

interface ScannedCardListProps {
  cards: ScannedCardListItem[];
  onCardUpdate?: (id: string, updates: Partial<ScannedCardListItem>) => void;
  onCardDelete?: (id: string) => void | Promise<void>;
  scanMode?: boolean;
  onAddToLibrary?: (id: string) => void | Promise<void>;
  onAddAllToLibrary?: () => void | Promise<void>;
  onReorder?: (orderedIds: string[]) => void;
}

export function ScannedCardList({
  cards,
  onCardUpdate,
  onCardDelete,
  scanMode = false,
  onAddToLibrary,
  onAddAllToLibrary,
  onReorder,
}: ScannedCardListProps) {
  if (cards.length === 0) return null;

  const completedCount = cards.filter((c) => c.status === "completed" && !c.dbId && c.cardName).length;

  return (
    <div className="space-y-3">
      {/* Bulk actions */}
      {scanMode && onAddAllToLibrary && completedCount > 0 && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/50 p-3">
          <span className="text-sm text-muted-foreground">
            {completedCount} card{completedCount !== 1 ? "s" : ""} ready to add
          </span>
          <Button size="sm" onClick={onAddAllToLibrary}>
            <Plus className="mr-1 h-4 w-4" /> Add All to Library
          </Button>
        </div>
      )}

      {/* Card list */}
      <div className="space-y-2">
        {cards.map((c) => (
          <Card key={c.id} className="p-3">
            <div className="flex items-center gap-3">
              <img
                src={c.preview || c.imageUrl}
                alt={c.cardName ? `Scanned card: ${c.cardName}` : "Scanned card"}
                className="h-20 w-14 rounded object-cover flex-shrink-0"
                loading="lazy"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">
                  {c.cardName ?? (c.status === "processing" ? "Processing…" : c.status === "queued" ? "Queued…" : "Unknown")}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {(c.cardSet ?? "") + (c.cardNumber ? ` • ${c.cardNumber}` : "")}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge
                    className={
                      c.status === "completed"
                        ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                        : c.status === "error"
                        ? "bg-destructive/10 text-destructive border-destructive/20"
                        : c.status === "processing"
                        ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {c.status}
                  </Badge>
                  {c.rarity && <Badge>{c.rarity}</Badge>}
                  {typeof c.value === "number" && (
                    <Badge className="bg-primary/10 text-primary border-primary/20">
                      ${c.value.toFixed(2)}
                    </Badge>
                  )}
                  {c.isInLibrary && (
                    <Badge className="bg-secondary text-secondary-foreground">
                      In Library {c.libraryQuantity && c.libraryQuantity > 1 ? `×${c.libraryQuantity}` : ""}
                    </Badge>
                  )}
                </div>
                {c.error && <div className="mt-1 text-xs text-destructive">{c.error}</div>}
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-1">
                {scanMode && onAddToLibrary && c.status === "completed" && !c.isInLibrary && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onAddToLibrary(c.id)}
                    disabled={c.priceFetching}
                    className="h-8 px-2"
                  >
                    {c.priceFetching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </Button>
                )}
                {onCardDelete && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onCardDelete(c.id)}
                    className="h-8 px-2 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
