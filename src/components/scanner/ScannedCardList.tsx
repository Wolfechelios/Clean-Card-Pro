import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ScannedCardList({
  cards,
  onRemove,
}: {
  cards: Array<{ id: string; preview: string; status: string; cardName?: string; value?: number | null }>;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {cards.map((c) => (
        <div key={c.id} className="flex items-center gap-3 rounded-md border bg-card p-2">
          <img
            src={c.preview}
            alt={c.cardName ? `Scanned card ${c.cardName}` : "Scanned card"}
            className={cn("h-12 w-10 rounded object-cover", c.status === "error" && "opacity-50")}
            loading="lazy"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{c.cardName ?? "Processing…"}</div>
            <div className="text-xs text-muted-foreground">{c.value != null ? `$${c.value}` : c.status}</div>
          </div>
          <Badge variant="outline">{c.status}</Badge>
          <Button size="sm" variant="ghost" onClick={() => onRemove(c.id)}>
            Remove
          </Button>
        </div>
      ))}
    </div>
  );
}
