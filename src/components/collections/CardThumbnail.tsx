import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, ImagePlus, Loader2, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PSA10PriceChip } from "@/components/pricing/PSA10PriceChip";

interface CardThumbnailProps {
  id: string;
  cardName: string;
  cardSet: string | null;
  cardNumber: string | null;
  imageUrl: string;
  thumbnailUrl: string | null;
  price: number | null;
  psa10Price?: number | null;
  isSelected: boolean;
  gameType?: string | null;
  sportType?: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClick: () => void;
  onImageUpdated?: () => void;
}

export function CardThumbnail({
  id,
  cardName,
  cardSet,
  cardNumber,
  imageUrl,
  thumbnailUrl,
  price,
  psa10Price,
  isSelected,
  gameType,
  sportType,
  onSelect,
  onDelete,
  onClick,
  onImageUpdated,
}: CardThumbnailProps) {
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [currentImageUrl, setCurrentImageUrl] = useState(thumbnailUrl || imageUrl);
  const hasPlaceholder = currentImageUrl?.includes("placehold") || !currentImageUrl;
  const showImage = currentImageUrl && !hasPlaceholder && !imageError;

  const handleImageLookup = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsLookingUp(true);

    try {
      // Step 1: Find the image URL
      const { data: lookupData, error: lookupError } = await supabase.functions.invoke("generate-card-image-url", {
        body: {
          cardName,
          cardSet,
          gameType: gameType || sportType,
        },
      });

      if (lookupError) throw lookupError;

      if (!lookupData?.found || !lookupData?.imageUrl || lookupData.imageUrl.includes("placehold")) {
        toast.info("No image found for this card");
        return;
      }

      // Step 2: Download and store the image in Supabase storage
      const { data: attachData, error: attachError } = await supabase.functions.invoke("attach-image", {
        body: {
          cardId: id,
          remoteImageUrl: lookupData.imageUrl,
        },
      });

      if (attachError) throw attachError;

      if (attachData?.success && attachData?.imageUrl) {
        // Update local state immediately so image shows
        setCurrentImageUrl(attachData.imageUrl);
        setImageError(false);
        toast.success("Image found and saved");
        onImageUpdated?.();
      } else {
        throw new Error(attachData?.error || "Failed to save image");
      }
    } catch (error: any) {
      console.error("Image lookup error:", error);
      toast.error("Failed to look up image");
    } finally {
      setIsLookingUp(false);
    }
  };

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

      {/* Action buttons */}
      <div className="absolute top-1.5 right-1.5 z-10 flex gap-1">
        {/* Find image button - show for placeholder or failed images */}
        {(hasPlaceholder || imageError) && (
          <button
            className={cn(
              "p-1 rounded-full",
              "bg-primary/90 text-primary-foreground",
              "opacity-0 group-hover:opacity-100 transition-opacity duration-150",
              "hover:bg-primary active:scale-90",
              isLookingUp && "opacity-100"
            )}
            onClick={handleImageLookup}
            disabled={isLookingUp}
            title="Find card image"
          >
            {isLookingUp ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ImagePlus className="h-3 w-3" />
            )}
          </button>
        )}

        {/* Delete button */}
        <button
          className={cn(
            "p-1 rounded-full",
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
      </div>

      {/* Square thumbnail */}
      <div className="aspect-square w-full overflow-hidden bg-muted flex items-center justify-center">
        {showImage ? (
          <img
            src={currentImageUrl}
            alt={cardName}
            loading="lazy"
            onError={() => setImageError(true)}
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-muted-foreground/50 p-2">
            <ImageOff className="h-8 w-8 mb-1" />
            <span className="text-[9px] text-center line-clamp-2">{cardName}</span>
          </div>
        )}
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
        {psa10Price !== null && psa10Price !== undefined && psa10Price > 0 && (
          <PSA10PriceChip price={psa10Price} className="mt-0.5 text-[9px]" />
        )}
      </div>
    </div>
  );
}
