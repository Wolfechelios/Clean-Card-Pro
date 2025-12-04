import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit2, DollarSign, Hash, Layers, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ScannedCard {
  id: string;
  preview: string;
  status: 'queued' | 'uploading' | 'processing' | 'completed' | 'error';
  cardName?: string;
  cardSet?: string;
  cardNumber?: string;
  rarity?: string;
  value?: number | null;
  error?: string;
  dbId?: string;
}

interface ScannedCardListProps {
  cards: ScannedCard[];
  onCardUpdate: (id: string, updates: Partial<ScannedCard>) => void;
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

export const ScannedCardList = ({ cards, onCardUpdate }: ScannedCardListProps) => {
  const [editingCard, setEditingCard] = useState<ScannedCard | null>(null);
  const [editForm, setEditForm] = useState({
    cardName: "",
    cardSet: "",
    cardNumber: "",
    rarity: "",
    value: "",
  });
  const [isSaving, setIsSaving] = useState(false);

  const completedCards = cards.filter(c => c.status === 'completed');
  const totalValue = completedCards.reduce((sum, c) => sum + (c.value || 0), 0);

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
          .from('cards')
          .update({
            card_name: editForm.cardName,
            card_set: editForm.cardSet,
            card_number: editForm.cardNumber,
            rarity: editForm.rarity,
            suggested_price: editForm.value ? parseFloat(editForm.value) : null,
          })
          .eq('id', editingCard.dbId);

        if (error) throw error;
      }

      toast.success('Card updated successfully');
      setEditingCard(null);
    } catch (error: any) {
      console.error('Failed to update card:', error);
      toast.error('Failed to save changes');
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
            <CardTitle className="text-lg">Scanned Cards ({completedCards.length})</CardTitle>
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-green-600" />
              <span className="text-xl font-bold text-green-600">
                ${totalValue.toFixed(2)}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {completedCards.map((card) => (
            <div
              key={card.id}
              className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
            >
              <img
                src={card.preview}
                alt={card.cardName || "Scanned card"}
                className="w-12 h-16 object-cover rounded"
              />
              <div className="flex-1 min-w-0 space-y-1">
                <p className="font-medium text-sm truncate">
                  {card.cardName || "Unknown Card"}
                </p>
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
                {card.value != null && card.value > 0 ? (
                  <p className="font-bold text-green-600">${card.value.toFixed(2)}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">No price</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => openEditDialog(card)}
                className="shrink-0"
              >
                <Edit2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!editingCard} onOpenChange={(open) => !open && setEditingCard(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Card Details</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {editingCard && (
              <div className="flex justify-center mb-4">
                <img
                  src={editingCard.preview}
                  alt="Card preview"
                  className="w-24 h-32 object-cover rounded-lg border"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="cardName">Card Name</Label>
              <Input
                id="cardName"
                value={editForm.cardName}
                onChange={(e) => setEditForm(prev => ({ ...prev, cardName: e.target.value }))}
                placeholder="Enter card name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cardSet">Set</Label>
              <Input
                id="cardSet"
                value={editForm.cardSet}
                onChange={(e) => setEditForm(prev => ({ ...prev, cardSet: e.target.value }))}
                placeholder="Enter card set"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cardNumber">Card Number</Label>
                <Input
                  id="cardNumber"
                  value={editForm.cardNumber}
                  onChange={(e) => setEditForm(prev => ({ ...prev, cardNumber: e.target.value }))}
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
                  onChange={(e) => setEditForm(prev => ({ ...prev, value: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rarity">Rarity</Label>
              <Select
                value={editForm.rarity}
                onValueChange={(value) => setEditForm(prev => ({ ...prev, rarity: value }))}
              >
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
