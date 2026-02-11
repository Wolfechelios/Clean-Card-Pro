import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search, CheckSquare, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Card {
  id: string;
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  image_url: string;
  current_price_raw: number | null;
  psa10_price: number | null;
}

interface PSA10CardSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onCardsSelected: (cardIds: string[]) => void;
}

export function PSA10CardSelector({ open, onOpenChange, userId, onCardsSelected }: PSA10CardSelectorProps) {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open && userId) {
      loadCards();
    }
  }, [open, userId]);

  const loadCards = async () => {
    setLoading(true);
    try {
      // Fetch all cards with pagination
      const allCards: Card[] = [];
      const pageSize = 1000;
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await supabase
          .from("cards")
          .select("id, card_name, card_set, card_number, image_url, current_price_raw, psa10_price")
          .eq("user_id", userId)
          .order("card_name")
          .range(offset, offset + pageSize - 1);

        if (error) throw error;
        
        if (data) {
          allCards.push(...(data as Card[]));
        }
        
        hasMore = data && data.length === pageSize;
        offset += pageSize;
      }

      setCards(allCards);
    } catch (err) {
      console.error("Failed to load cards:", err);
    } finally {
      setLoading(false);
    }
  };

  const filteredCards = cards.filter(card => {
    const searchLower = search.toLowerCase();
    return (
      card.card_name.toLowerCase().includes(searchLower) ||
      card.card_set?.toLowerCase().includes(searchLower) ||
      card.card_number?.toLowerCase().includes(searchLower)
    );
  });

  const toggleCard = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(filteredCards.map(c => c.id)));
  };

  const selectNone = () => {
    setSelected(new Set());
  };

  const selectMissingPSA10 = () => {
    const missing = filteredCards.filter(c => !c.psa10_price).map(c => c.id);
    setSelected(new Set(missing));
  };

  const handleConfirm = () => {
    onCardsSelected(Array.from(selected));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Select Cards for PSA 10 Analysis</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 flex-1 min-h-0">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search cards..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Quick select buttons */}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={selectAll}>
              <CheckSquare className="h-4 w-4 mr-1" />
              All ({filteredCards.length})
            </Button>
            <Button variant="outline" size="sm" onClick={selectNone}>
              <Square className="h-4 w-4 mr-1" />
              None
            </Button>
            <Button variant="outline" size="sm" onClick={selectMissingPSA10}>
              Missing PSA 10 ({filteredCards.filter(c => !c.psa10_price).length})
            </Button>
          </div>

          {/* Card list */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="flex-1 border rounded-md">
              <div className="divide-y divide-border">
                {filteredCards.map(card => (
                  <label
                    key={card.id}
                    className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer"
                  >
                    <Checkbox
                      checked={selected.has(card.id)}
                      onCheckedChange={() => toggleCard(card.id)}
                    />
                    <img
                      src={card.image_url}
                      alt={card.card_name}
                      className="w-10 h-14 object-cover rounded"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{card.card_name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {[card.card_set, card.card_number].filter(Boolean).join(" • ")}
                      </div>
                    </div>
                    <div className="text-right text-xs">
                      {card.current_price_raw && (
                        <div className="text-muted-foreground">Raw: ${card.current_price_raw.toFixed(2)}</div>
                      )}
                      {card.psa10_price ? (
                        <div className="text-success">PSA 10: ${card.psa10_price.toFixed(2)}</div>
                      ) : (
                        <div className="text-muted-foreground italic">No PSA 10</div>
                      )}
                    </div>
                  </label>
                ))}
                {filteredCards.length === 0 && (
                  <div className="p-8 text-center text-muted-foreground">
                    {search ? "No cards match your search" : "No cards in collection"}
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div className="text-sm text-muted-foreground">
            {selected.size} card{selected.size !== 1 ? "s" : ""} selected
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm} disabled={selected.size === 0}>
              Analyze Selected
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
