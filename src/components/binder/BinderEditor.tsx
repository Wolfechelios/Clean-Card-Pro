import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SlotGrid } from "./SlotGrid";
import { Edit, Save, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Card {
  id: string;
  card_name: string;
  image_url: string;
  thumbnail_url?: string;
  current_price_raw?: number;
  collection_name: string | null;
}

interface BinderEditorProps {
  binderName: string;
  cards: Card[];
  onUpdate: () => void;
}

export function BinderEditor({ binderName, cards, onUpdate }: BinderEditorProps) {
  const [layout, setLayout] = useState<"3x3" | "3x4" | "4x3">("3x3");
  const [slots, setSlots] = useState<(Card | null)[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [availableCards, setAvailableCards] = useState<Card[]>([]);

  const getLayoutDimensions = (layout: string) => {
    const [cols, rows] = layout.split("x").map(Number);
    return { columns: cols, rows, total: cols * rows };
  };

  useEffect(() => {
    const { total } = getLayoutDimensions(layout);
    const newSlots = Array(total).fill(null);
    
    // Fill slots with cards from binder
    cards.forEach((card, index) => {
      if (index < total) {
        newSlots[index] = card;
      }
    });

    setSlots(newSlots);
  }, [layout, cards]);

  useEffect(() => {
    if (isEditing) {
      fetchAvailableCards();
    }
  }, [isEditing]);

  const fetchAvailableCards = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data } = await supabase
      .from("cards")
      .select("id, card_name, image_url, thumbnail_url, current_price_raw, collection_name")
      .eq("user_id", session.user.id)
      .or(`collection_name.is.null,collection_name.neq.${binderName}`);

    setAvailableCards(data || []);
  };

  const handleSlotClick = (index: number) => {
    if (isEditing) {
      setSelectedSlot(index);
    }
  };

  const handleCardSelect = async (card: Card) => {
    if (selectedSlot === null) return;

    const newSlots = [...slots];
    newSlots[selectedSlot] = card;
    setSlots(newSlots);

    // Update card's collection in database
    await supabase
      .from("cards")
      .update({ collection_name: binderName })
      .eq("id", card.id);

    setSelectedSlot(null);
    onUpdate();
  };

  const handleCardRemove = async (cardId: string, index: number) => {
    const newSlots = [...slots];
    newSlots[index] = null;
    setSlots(newSlots);

    // Remove from binder (set collection to null)
    await supabase
      .from("cards")
      .update({ collection_name: null })
      .eq("id", cardId);

    toast.success("Card removed from binder");
    onUpdate();
  };

  const handleSave = () => {
    setIsEditing(false);
    toast.success("Binder layout saved");
  };

  return (
    <Card className="bg-neutral-900 border-neutral-800">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5" />
            {binderName}
          </CardTitle>
          <div className="flex gap-2">
            <Select value={layout} onValueChange={(v) => setLayout(v as any)}>
              <SelectTrigger className="w-32 bg-neutral-800 border-neutral-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3x3">3x3</SelectItem>
                <SelectItem value="3x4">3x4</SelectItem>
                <SelectItem value="4x3">4x3</SelectItem>
              </SelectContent>
            </Select>
            {isEditing ? (
              <Button onClick={handleSave} size="sm">
                <Save className="mr-2 h-4 w-4" />
                Save
              </Button>
            ) : (
              <Button onClick={() => setIsEditing(true)} size="sm">
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <SlotGrid
          cards={slots}
          columns={getLayoutDimensions(layout).columns}
          onSlotClick={handleSlotClick}
          onCardRemove={isEditing ? handleCardRemove : undefined}
        />

        <Dialog open={selectedSlot !== null} onOpenChange={() => setSelectedSlot(null)}>
          <DialogContent className="bg-neutral-900 border-neutral-800 max-w-2xl">
            <DialogHeader>
              <DialogTitle>Select Card for Slot {(selectedSlot || 0) + 1}</DialogTitle>
            </DialogHeader>
            <div className="max-h-96 overflow-y-auto">
              <div className="grid grid-cols-3 gap-3">
                {availableCards.map((card) => (
                  <div
                    key={card.id}
                    className="cursor-pointer hover:scale-105 transition-transform"
                    onClick={() => handleCardSelect(card)}
                  >
                    <img
                      src={card.thumbnail_url || card.image_url}
                      alt={card.card_name}
                      className="w-full aspect-[3/4] object-cover rounded"
                    />
                    <p className="text-xs font-medium mt-1 truncate">{card.card_name}</p>
                  </div>
                ))}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
