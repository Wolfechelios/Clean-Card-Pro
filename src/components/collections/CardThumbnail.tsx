import { Checkbox } from "@/components/ui/checkbox";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface CardThumbnailProps {
  id: string;
  cardName: string;
  cardSet: string | null;
  cardNumber: string | null;
  imageUrl: string;
  thumbnailUrl: string | null;
  price: number | null;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClick: () => void;
}

export function CardThumbnail({
  id,
  cardName,
  cardSet,
  cardNumber,
  imageUrl,
  thumbnailUrl,
  price,
  isSelected,
  onSelect,
  onDelete,
  onClick,
}: CardThumbnailProps) {
  return (
    <div
      className={cn(
        "group relative flex flex-col rounded-lg overflow-hidden cursor-pointer",
        "bg-card border border-border",
        "transition-all duration-200",
        "hover:shadow-lg hover:border-primary/40 hover:-translate-y-0.5 active:scale-95",
        isSelected && "ring-2 ring-primary border-primary"
      )}
      onClick={onClick}
    >
      {/* Selection checkbox */}
      <div
        className="absolute top-1.5 left-1.5 z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onSelect(id)}
          className="h-4 w-4 bg-background/90 border-border shadow-sm"
        />
      </div>

      {/* Delete button */}
      <button
        className={cn(
          "absolute top-1.5 right-1.5 z-10 p-1 rounded-full",
          "bg-destructive/90 text-destructive-foreground",
          "opacity-0 group-hover:opacity-100 transition-opacity duration-150",
          "hover:bg-destructive active:scale-90"
        )}
        onClick={(e) => {
          e.stopPropagation();
          onDelete(id);
        }}
      >
        <Trash2 className="h-3 w-3" />
      </button>

      {/* Square thumbnail */}
      <div className="aspect-square w-full overflow-hidden bg-muted">
        <img
          src={thumbnailUrl || imageUrl}
          alt={cardName}
          loading="lazy"
          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
        />
      </div>

      {/* Compact label */}
      <div className="p-1.5 flex flex-col items-center text-center min-h-[44px]">
        <p className="text-[11px] leading-tight font-medium text-foreground line-clamp-1 w-full">
          {cardSet || "Unknown Set"}
        </p>
        <p className="text-[10px] leading-tight text-muted-foreground line-clamp-1 w-full">
          {cardNumber ? `#${cardNumber}` : cardName.slice(0, 20)}
        </p>
        {price !== null && price > 0 && (
          <p className="text-[10px] font-semibold text-primary mt-0.5">
            ${price.toFixed(2)}
          </p>
        )}
      </div>
    </div>
  );
}
