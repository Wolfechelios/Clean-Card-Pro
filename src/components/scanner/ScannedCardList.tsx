import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit2, DollarSign, Hash, Layers, Sparkles, Trash2, Loader2, Library, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ScannedCard {
  id: string;
  preview: string;
  status: "queued" | "uploading" | "processing" | "completed" | "error";
  cardName?: string;
  cardSet?: string;
  cardNumber?: string;
  rarity?: string;
  value?: number | null;
  error?: string;
  dbId?: string;
  priceFetching?: boolean;
  // Scan mode fields
  libraryQuantity?: number;
  isInLibrary?: boolean;
  imageUrl?: string;
}

interface ScannedCardListProps {
  cards: ScannedCard[];
  onCardUpdate: (id: string, updates: Partial<ScannedCard>) => void;
  onCardDelete?: (id: string) => void;
  scanMode?: boolean;
  onAddToLibrary?: (id: string) => void;
  onReorder?: (orderedIds: string[]) => void;
}

const RARITY_OPTIONS = [
  "Common",
  "Uncommon",
  "Rare",
  "Super Rare",
  "Ultra Rare",
  "Secret Rare",
  "Starlight Rare",
  "Ghost Rare",
  "Prismatic Secret Rare",
  "1st Edition",
  "Limited Edition",
  "Holo Rare",
  "Reverse Holo",
];

// ✅ Preview sizing (change these if you want even bigger/smaller)
const LIST_THUMB_CLASS = "w-16 h-24 object-cover rounded"; // was w-12 h-16
const EDIT_PREVIEW_CLASS = "w-40 h-56 object-cover rounded-lg border"; // was w-24 h-32

export const ScannedCardList = ({
  cards,
  onCardUpdate,
  onCardDelete,
  scanMode,
  onAddToLibrary,
  onReorder,
}: ScannedCardListProps) => {
  const [editingCard, setEditingCard] = useState<ScannedCard | null>(null);
  const [editForm, setEditForm] = useState({
    cardName: "",
    cardSet: "",
    cardNumber: "",
    rarity: "",
    value: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  const completedCards = cards.filter((c) => c.status === "completed");
  const [dragId, setDragId] = useState<string | null>(null);
  const totalValue = completedCards.reduce((sum, c) => sum + (c.value || 0), 0);
  const newCardsCount = scanMode ? completedCards.filter((c) => !c.dbId).length : 0;

  const openEditDialog = (card: ScannedCard) => {
    setEditingCard(card);
    setEditForm({
      cardName: card.cardName || "",
      cardSet: card.cardSet || "",
      cardNumber: card.cardNumber || "",
      rarity: card.rarity || "",
      value: card.value?.toString() || "",
    });
  };

  const handleDropReorder = (targetId: string) => {
    if (!onReorder) return;
    if (!dragId || dragId === targetId) return;

    const ordered = [...completedCards];
    const from = ordered.findIndex((c) => c.id === dragId);
    const to = ordered.findIndex((c) => c.id === targetId);
    if (from < 0 || to < 0) return;

    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    onReorder(ordered.map((c) => c.id));
  };

  const handleDelete = async (card: ScannedCard) => {
    if (!onCardDelete) return;

    setDeletingId(card.id);
    try {
      // If we have a database ID, delete from database
      if (card.dbId) {
        const { error } = await supabase.from("cards").delete().eq("id", card.dbId);
        if (error) throw error;
      }

      onCardDelete(card.id);
      toast.success("Card deleted");
    } catch (error: any) {
      console.error("Failed to delete card:", error);
      toast.error("Failed to delete card");
    } finally {
      setDeletingId(null);
    }
  };

  const handleSave = async () => {
    if (!editingCard) return;

    setIsSaving(true);
    try {
      // Update local state
      onCardUpdate(editingCard.id, {
        cardName: editForm.cardName,
        cardSet: editForm.cardSet,
        cardNumber: editForm.cardNumber,
        rarity: editForm.rarity,
        value: editForm.value ? parseFloat(editForm.value) : null,
      });

      // If we have a database ID, update the database too
      if (editingCard.dbId) {
        const { error } = await supabase
          .from("cards")
          .update({
            card_name: editForm.cardName,
            card_set: editForm.cardSet,
            card_number: editForm.cardNumber,
            rarity: editForm.rarity,
            suggested_price: editForm.value ? parseFloat(editForm.value) : null,
          })
          .eq("id", editingCard.dbId);

        if (error) throw error;
      }

      toast.success("Card updated successfully");
      setEditingCard(null);
    } catch (error: any) {
      console.error("Failed to update card:", error);
      toast.error("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  if (completedCards.length === 0) return null;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">Scanned Cards ({completedCards.length})</CardTitle>
              {scanMode && newCardsCount > 0 && (
                <Badge
                  variant="outline"
                  className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-300"
                >
                  {newCardsCount} New
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-green-600" />
              <span className="text-xl font-bold text-green-600">${totalValue.toFixed(2)}</span>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {completedCards.map((card) => (
            <div
              key={card.id}
              draggable={Boolean(onReorder)}
              onDragStart={() => setDragId(card.id)}
              onDragOver={(e) => {
                if (!onReorder) return;
                e.preventDefault();
              }}
              onDrop={() => {
                if (!onReorder || !dragId || dragId === card.id) return;
                const ids = completedCards.map((c) => c.id);
                const from = ids.indexOf(dragId);
                const to = ids.indexOf(card.id);
                if (from < 0 || to < 0) return;
                const next = [...ids];
                next.splice(from, 1);
                next.splice(to, 0, dragId);
                onReorder(next);
                setDragId(null);
              }}
              className={`flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors ${
                scanMode && !card.dbId ? "border-amber-400 dark:border-amber-600" : ""
              }`}
            >
              {/* Card image with quantity badge */}
              <div className="relative shrink-0">
                <img
                  src={card.preview}
                  alt={card.cardName || "Scanned card"}
                  className={LIST_THUMB_CLASS}
                />

                {/* Library quantity badge */}
                {card.libraryQuantity !== undefined && card.libraryQuantity > 0 && (
                  <div className="absolute -top-1 -right-1 bg-blue-600 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                    ×{card.libraryQuantity}
                  </div>
                )}

                {/* New card indicator */}
                {scanMode && !card.dbId && card.libraryQuantity === 0 && (
                  <div className="absolute -top-1 -right-1 bg-amber-500 text-white text-[8px] font-bold rounded px-1">
                    NEW
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0 space-y-1">
                <p className="font-medium text-sm truncate">{card.cardName || "Unknown Card"}</p>

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {card.cardSet && (
                    <span className="flex items-center gap-1">
                      <Layers className="h-3 w-3" />
                      {card.cardSet}
                    </span>
                  )}
                  {card.cardNumber && (
                    <span className="flex items-center gap-1">
                      <Hash className="h-3 w-3" />
                      {card.cardNumber}
                    </span>
                  )}
                </div>

                {card.rarity && (
                  <Badge variant="secondary" className="text-[10px]">
                    <Sparkles className="h-2.5 w-2.5 mr-1" />
                    {card.rarity}
                  </Badge>
                )}
              </div>

              <div className="text-right">
                {card.priceFetching ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                  </span>
                ) : card.value != null && card.value > 0 ? (
                  <p className="font-bold text-green-600">${card.value.toFixed(2)}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">No price</p>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {/* Add to Library button for scan mode */}
                {scanMode && !card.dbId && onAddToLibrary && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAddingId(card.id);
                      onAddToLibrary(card.id);
                      setTimeout(() => setAddingId(null), 2000);
                    }}
                    disabled={addingId === card.id || card.priceFetching}
                    className="text-xs h-7 px-2 gap-1 border-amber-400 text-amber-700 hover:bg-amber-50 dark:border-amber-600 dark:text-amber-300"
                  >
                    {addingId === card.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                    Add
                  </Button>
                )}

                {/* Already in library indicator */}
                {scanMode && card.dbId && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                  >
                    <Library className="h-2.5 w-2.5 mr-1" />
                    Added
                  </Badge>
                )}

                <Button variant="ghost" size="icon" onClick={() => openEditDialog(card)}>
                  <Edit2 className="h-4 w-4" />
                </Button>

                {onCardDelete && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(card)}
                    disabled={deletingId === card.id}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    {deletingId === card.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!editingCard} onOpenChange={(open) => !open && setEditingCard(null)}>
        {/* widened from sm:max-w-md */}
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Card Details</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {editingCard && (
              <div className="flex justify-center mb-4">
                <img src={editingCard.preview} alt="Card preview" className={EDIT_PREVIEW_CLASS} />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="cardName">Card Name</Label>
              <Input
                id="cardName"
                value={editForm.cardName}
                onChange={(e) => setEditForm((prev) => ({ ...prev, cardName: e.target.value }))}
                placeholder="Enter card name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cardSet">Set</Label>
              <Input
                id="cardSet"
                value={editForm.cardSet}
                onChange={(e) => setEditForm((prev) => ({ ...prev, cardSet: e.target.value }))}
                placeholder="Enter card set"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cardNumber">Card Number</Label>
                <Input
                  id="cardNumber"
                  value={editForm.cardNumber}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, cardNumber: e.target.value }))}
                  placeholder="e.g. MRL-051"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="value">Value ($)</Label>
                <Input
                  id="value"
                  type="number"
                  step="0.01"
                  value={editForm.value}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, value: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rarity">Rarity</Label>
              <Select value={editForm.rarity} onValueChange={(value) => setEditForm((prev) => ({ ...prev, rarity: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select rarity" />
                </SelectTrigger>
                <SelectContent>
                  {RARITY_OPTIONS.map((rarity) => (
                    <SelectItem key={rarity} value={rarity}>
                      {rarity}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCard(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
