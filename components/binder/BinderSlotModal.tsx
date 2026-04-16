import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { BinderSlot } from "@/hooks/use-binder-data";

interface BinderSlotModalProps {
  slot: BinderSlot;
  onClose: () => void;
}

export function BinderSlotModal({ slot, onClose }: BinderSlotModalProps) {
  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">{slot.cardName}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Image */}
          {slot.owned && slot.imageUrl ? (
            <img
              src={slot.imageUrl}
              alt={slot.cardName}
              className="w-full rounded-lg border border-border/60"
            />
          ) : (
            <div className="aspect-[2.5/3.5] rounded-lg bg-muted/30 border border-dashed border-border/40 flex items-center justify-center">
              <span className="text-muted-foreground text-sm">Not in collection</span>
            </div>
          )}

          {/* Details */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground text-xs">Card #</span>
              <p className="font-mono font-medium">{slot.cardNumber}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Variant</span>
              <p className="capitalize">{slot.variant}</p>
            </div>
            {slot.rarity && (
              <div>
                <span className="text-muted-foreground text-xs">Rarity</span>
                <p className="capitalize">{slot.rarity}</p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground text-xs">Status</span>
              <div>
                {slot.owned ? (
                  <Badge variant="secondary" className="bg-primary/10 text-primary text-xs">
                    Owned{slot.quantity > 1 ? ` (x${slot.quantity})` : ""}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">Missing</Badge>
                )}
              </div>
            </div>
          </div>

          {/* Pricing */}
          {(slot.rawPrice || slot.psa10Price) && (
            <div className="flex gap-3 text-sm">
              {slot.rawPrice != null && (
                <div className="flex-1 p-2 rounded-lg bg-secondary/50 text-center">
                  <span className="text-muted-foreground text-xs block">Raw</span>
                  <span className="font-semibold">${slot.rawPrice.toFixed(2)}</span>
                </div>
              )}
              {slot.psa10Price != null && (
                <div className="flex-1 p-2 rounded-lg bg-secondary/50 text-center">
                  <span className="text-muted-foreground text-xs block">PSA 10</span>
                  <span className="font-semibold">${slot.psa10Price.toFixed(2)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
