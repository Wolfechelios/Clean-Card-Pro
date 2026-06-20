import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SetEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  set: { id: string; game: string; set_code: string | null; set_name: string; total_cards: number };
  onSaved: () => void;
}

export function SetEditDialog({ open, onOpenChange, set, onSaved }: SetEditDialogProps) {
  const [game, setGame] = useState(set.game);
  const [setCode, setSetCode] = useState(set.set_code || "");
  const [setName, setSetName] = useState(set.set_name);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("pc_sets")
      .update({ game, set_code: setCode || null, set_name: setName })
      .eq("id", set.id);

    if (error) {
      toast.error("Failed to update set");
    } else {
      toast.success("Set updated");
      onSaved();
      onOpenChange(false);
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Set</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Set Name</Label>
            <Input value={setName} onChange={(e) => setSetName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Set Code</Label>
            <Input value={setCode} onChange={(e) => setSetCode(e.target.value)} placeholder="e.g. SDJ" />
          </div>
          <div className="space-y-2">
            <Label>Game</Label>
            <Select value={game} onValueChange={setGame}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="yugioh">Yu-Gi-Oh!</SelectItem>
                <SelectItem value="pokemon">Pokémon</SelectItem>
                <SelectItem value="mtg">Magic: The Gathering</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !setName.trim()}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
