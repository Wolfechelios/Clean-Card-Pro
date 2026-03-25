// FoilCorrectionModal — lets user correct finish/rarity for a foil scan

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FoilIssueTagPicker } from "./FoilIssueTagPicker";
import type { FinishType, FoilIssueTag } from "@/lib/foilTrainer/types";

const FINISH_OPTIONS: { value: FinishType; label: string }[] = [
  { value: "normal", label: "Normal (no foil)" },
  { value: "holo", label: "Holo" },
  { value: "reverse_holo", label: "Reverse Holo" },
  { value: "etched", label: "Etched Foil" },
  { value: "rainbow", label: "Rainbow" },
  { value: "secret", label: "Secret" },
  { value: "textured", label: "Textured" },
  { value: "metallic", label: "Metallic" },
  { value: "stamped", label: "Stamped" },
  { value: "prizm", label: "Prizm / Prism" },
  { value: "cracked_ice", label: "Cracked Ice" },
  { value: "shimmer", label: "Shimmer" },
  { value: "refractor", label: "Refractor" },
  { value: "showcase", label: "Showcase" },
  { value: "foil", label: "Foil (generic)" },
  { value: "gold", label: "Gold" },
  { value: "silver", label: "Silver" },
];

interface FoilCorrectionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  predictedFinish: string | null;
  predictedRarity: string | null;
  onSubmit: (data: {
    correctedFinish: FinishType;
    correctedRarity: string;
    issueTags: FoilIssueTag[];
    note: string;
  }) => void;
}

export function FoilCorrectionModal({
  open,
  onOpenChange,
  predictedFinish,
  predictedRarity,
  onSubmit,
}: FoilCorrectionModalProps) {
  const [correctedFinish, setCorrectedFinish] = useState<FinishType>(
    (predictedFinish as FinishType) || "normal",
  );
  const [correctedRarity, setCorrectedRarity] = useState(predictedRarity || "");
  const [issueTags, setIssueTags] = useState<FoilIssueTag[]>([]);
  const [note, setNote] = useState("");

  const handleSubmit = () => {
    onSubmit({
      correctedFinish,
      correctedRarity,
      issueTags,
      note,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Fix Finish / Rarity</DialogTitle>
          <DialogDescription>
            Correct the detected foil finish and rarity. Your correction helps improve future scans.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Correct Finish</Label>
            <Select value={correctedFinish} onValueChange={(v) => setCorrectedFinish(v as FinishType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FINISH_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Correct Rarity</Label>
            <Input
              value={correctedRarity}
              onChange={(e) => setCorrectedRarity(e.target.value)}
              placeholder="e.g. Secret Rare, Ultra Rare"
            />
          </div>

          <div className="space-y-2">
            <Label>Issue Tags (optional)</Label>
            <FoilIssueTagPicker selected={issueTags} onChange={setIssueTags} />
          </div>

          <div className="space-y-2">
            <Label>Note (optional)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Any additional context..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Save Correction</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
