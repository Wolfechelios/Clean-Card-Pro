import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface SetOption {
  id: string;
  set_name: string;
  set_code: string | null;
  total_cards: number;
}

interface MergeSetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sets: SetOption[];
  onMerged: () => void;
}

export function MergeSetsDialog({ open, onOpenChange, sets, onMerged }: MergeSetsDialogProps) {
  const [targetId, setTargetId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [merging, setMerging] = useState(false);

  const handleMerge = async () => {
    if (!targetId || !sourceId || targetId === sourceId) return;
    setMerging(true);

    try {
      // Move all cards from source to target
      const { error: moveErr } = await supabase
        .from("pc_cards")
        .update({ set_id: targetId })
        .eq("set_id", sourceId);

      if (moveErr) throw moveErr;

      // Update target card count
      const { count } = await supabase
        .from("pc_cards")
        .select("id", { count: "exact", head: true })
        .eq("set_id", targetId);

      await supabase
        .from("pc_sets")
        .update({ total_cards: count || 0 })
        .eq("id", targetId);

      // Delete empty source set
      await supabase.from("pc_sets").delete().eq("id", sourceId);

      toast.success("Sets merged successfully");
      onMerged();
      onOpenChange(false);
    } catch (err) {
      console.error("Merge error:", err);
      toast.error("Failed to merge sets");
    }

    setMerging(false);
  };

  const targetSet = sets.find((s) => s.id === targetId);
  const sourceSet = sets.find((s) => s.id === sourceId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Merge Sets</DialogTitle>
          <DialogDescription>Move all cards from one set into another, then delete the empty set.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Keep (target set)</Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger><SelectValue placeholder="Select target set" /></SelectTrigger>
              <SelectContent>
                {sets.filter((s) => s.id !== sourceId).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.set_name} {s.set_code && `(${s.set_code})`} — {s.total_cards} cards
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Merge from (will be deleted)</Label>
            <Select value={sourceId} onValueChange={setSourceId}>
              <SelectTrigger><SelectValue placeholder="Select source set" /></SelectTrigger>
              <SelectContent>
                {sets.filter((s) => s.id !== targetId).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.set_name} {s.set_code && `(${s.set_code})`} — {s.total_cards} cards
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {targetSet && sourceSet && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {sourceSet.total_cards} cards from "{sourceSet.set_name}" will be moved into "{targetSet.set_name}". The source set will be deleted.
              </AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleMerge} disabled={merging || !targetId || !sourceId || targetId === sourceId} variant="destructive">
            {merging ? "Merging..." : "Merge Sets"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
