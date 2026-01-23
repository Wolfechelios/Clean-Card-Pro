import { Card } from "../ui/card";
import { Badge } from "../ui/badge";

export type ScannedCardListItem = {
  id: string;
  preview: string;
  status: string;
  cardName?: string;
  cardSet?: string;
  cardNumber?: string;
  rarity?: string;
  value?: number | null;
  isInLibrary?: boolean;
  libraryQuantity?: number;
  error?: string;
};

export function ScannedCardList(props: { cards: ScannedCardListItem[] }) {
  if (props.cards.length === 0) return null;
  return (
    <div className="space-y-2">
      {props.cards.map((c) => (
        <Card key={c.id} className="p-3">
          <div className="flex items-center gap-3">
            <img
              src={c.preview}
              alt={c.cardName ? `Scanned card: ${c.cardName}` : "Scanned card"}
              className="h-20 w-14 rounded object-cover"
              loading="lazy"
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold truncate">{c.cardName ?? "Processing…"}</div>
              <div className="text-xs text-muted-foreground truncate">
                {(c.cardSet ?? "") + (c.cardNumber ? ` • ${c.cardNumber}` : "")}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge>{c.status}</Badge>
                {c.rarity ? <Badge>{c.rarity}</Badge> : null}
                {typeof c.value === "number" ? <Badge>${c.value.toFixed(2)}</Badge> : null}
              </div>
              {c.error ? <div className="mt-1 text-xs text-destructive">{c.error}</div> : null}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
