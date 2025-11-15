import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SlotCardProps {
  cardId?: string;
  cardName?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  price?: number;
  isEmpty?: boolean;
  isProcessing?: boolean;
  onRemove?: () => void;
  onClick?: () => void;
  className?: string;
}

export function SlotCard({
  cardName,
  imageUrl,
  thumbnailUrl,
  price,
  isEmpty = false,
  isProcessing = false,
  onRemove,
  onClick,
  className,
}: SlotCardProps) {
  return (
    <Card
      className={cn(
        "relative aspect-[3/4] overflow-hidden transition-all cursor-pointer group",
        isEmpty && "border-dashed border-2 bg-neutral-900/50",
        isProcessing && "animate-pulse",
        className
      )}
      onClick={onClick}
    >
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center h-full text-neutral-600">
          <ImageIcon className="h-8 w-8 mb-2" />
          <span className="text-xs">Empty Slot</span>
        </div>
      ) : (
        <>
          <img
            src={thumbnailUrl || imageUrl}
            alt={cardName}
            className="w-full h-full object-cover"
          />
          {onRemove && (
            <Button
              size="icon"
              variant="destructive"
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
          {cardName && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
              <p className="text-xs text-white font-medium truncate">{cardName}</p>
              {price != null && (
                <p className="text-xs text-neutral-300">${price.toFixed(2)}</p>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
