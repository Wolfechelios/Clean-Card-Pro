import { AlertTriangle, Copy, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface ExistingCard {
  id: string;
  card_name: string;
  card_set: string | null;
  image_url: string;
  current_price_raw: number | null;
}

interface NewCard {
  card_name: string;
  card_set: string | null;
  confidence: number;
}

interface DuplicateCardDialogProps {
  open: boolean;
  existingCard: ExistingCard;
  newCard: NewCard;
  newImageUrl: string;
  onAddAnyway: () => void;
  onSkip: () => void;
}

export function DuplicateCardDialog({
  open,
  existingCard,
  newCard,
  newImageUrl,
  onAddAnyway,
  onSkip,
}: DuplicateCardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onSkip()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-warning">
            <AlertTriangle className="h-5 w-5" />
            Duplicate Card Detected
          </DialogTitle>
          <DialogDescription>
            This card appears to already be in your collection. Would you like to add it anyway?
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 py-4">
          {/* Existing Card */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                <Copy className="h-3 w-3 mr-1" />
                In Collection
              </Badge>
            </div>
            <div className="aspect-[5/7] rounded-lg overflow-hidden border border-border bg-secondary/50">
              <img
                src={existingCard.image_url}
                alt={existingCard.card_name}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="space-y-1">
              <p className="font-medium text-sm truncate">{existingCard.card_name}</p>
              <p className="text-xs text-muted-foreground truncate">{existingCard.card_set || "Unknown Set"}</p>
              {existingCard.current_price_raw && (
                <p className="text-xs text-success font-medium">
                  ${existingCard.current_price_raw.toFixed(2)}
                </p>
              )}
            </div>
          </div>

          {/* New Card */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                <Plus className="h-3 w-3 mr-1" />
                New Scan
              </Badge>
            </div>
            <div className="aspect-[5/7] rounded-lg overflow-hidden border border-primary/50 bg-secondary/50">
              <img
                src={newImageUrl}
                alt={newCard.card_name}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="space-y-1">
              <p className="font-medium text-sm truncate">{newCard.card_name}</p>
              <p className="text-xs text-muted-foreground truncate">{newCard.card_set || "Unknown Set"}</p>
              <p className="text-xs text-muted-foreground">
                {newCard.confidence}% confidence
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button variant="outline" onClick={onSkip} className="flex-1 sm:flex-none">
            <X className="h-4 w-4 mr-2" />
            Skip
          </Button>
          <Button onClick={onAddAnyway} className="flex-1 sm:flex-none">
            <Plus className="h-4 w-4 mr-2" />
            Add Anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
