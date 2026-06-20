import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CardRow {
  id: string;
  card_name: string;
  card_number: string | null;
  variant: string | null;
  ungraded_price: number | null;
  graded_price: number | null;
  grade9_price: number | null;
  psa10_price: number | null;
}

interface CardEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  card: CardRow;
  onSaved: () => void;
}

export function CardEditDialog({ open, onOpenChange, card, onSaved }: CardEditDialogProps) {
  const [cardName, setCardName] = useState(card.card_name);
  const [cardNumber, setCardNumber] = useState(card.card_number || "");
  const [variant, setVariant] = useState(card.variant || "");
  const [ungradedPrice, setUngradedPrice] = useState(card.ungraded_price?.toString() || "");
  const [gradedPrice, setGradedPrice] = useState(card.graded_price?.toString() || "");
  const [grade9Price, setGrade9Price] = useState(card.grade9_price?.toString() || "");
  const [psa10Price, setPsa10Price] = useState(card.psa10_price?.toString() || "");
  const [saving, setSaving] = useState(false);

  const parsePrice = (v: string) => {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };

  const handleSave = async () => {
    setSaving(true);
    const cleanName = cardName.replace(/\s*\[.*?\]\s*/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

    const { error } = await supabase
      .from("pc_cards")
      .update({
        card_name: cardName,
        card_name_clean: cleanName,
        card_number: cardNumber || null,
        variant: variant || null,
        ungraded_price: parsePrice(ungradedPrice),
        graded_price: parsePrice(gradedPrice),
        grade9_price: parsePrice(grade9Price),
        psa10_price: parsePrice(psa10Price),
      })
      .eq("id", card.id);

    if (error) {
      toast.error("Failed to update card");
    } else {
      toast.success("Card updated");
      onSaved();
      onOpenChange(false);
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Card</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Card Name</Label>
            <Input value={cardName} onChange={(e) => setCardName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Card Number</Label>
              <Input value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} placeholder="e.g. SDJ-001" />
            </div>
            <div className="space-y-1">
              <Label>Variant</Label>
              <Input value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="e.g. 1st Edition" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Ungraded $</Label>
              <Input type="number" step="0.01" value={ungradedPrice} onChange={(e) => setUngradedPrice(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Graded $</Label>
              <Input type="number" step="0.01" value={gradedPrice} onChange={(e) => setGradedPrice(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>PSA 9 $</Label>
              <Input type="number" step="0.01" value={grade9Price} onChange={(e) => setGrade9Price(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>PSA 10 $</Label>
              <Input type="number" step="0.01" value={psa10Price} onChange={(e) => setPsa10Price(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !cardName.trim()}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
