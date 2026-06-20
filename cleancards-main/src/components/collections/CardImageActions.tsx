import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ImagePlus, Lock, Unlock, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface CardImageActionsProps {
  cardId: string;
  imageUrl: string | null;
  imageLocked: boolean;
  imageSource: string | null;
  onImageUpdated?: () => void;
}

export function CardImageActions({
  cardId,
  imageUrl,
  imageLocked,
  imageSource,
  onImageUpdated,
}: CardImageActionsProps) {
  const [isSearching, setIsSearching] = useState(false);
  const [isLocked, setIsLocked] = useState(imageLocked);
  const [isUpdatingLock, setIsUpdatingLock] = useState(false);

  const handleFindImage = async () => {
    if (isLocked) {
      toast.info("Image is locked. Unlock to search for a new image.");
      return;
    }

    setIsSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke("resolve-card-image", {
        body: { card_id: cardId },
      });

      if (error) throw error;

      if (data.status === "found" || data.status === "cached") {
        toast.success(`Image found from ${data.source || "database"}`);
        onImageUpdated?.();
      } else if (data.status === "locked") {
        toast.info("Image is locked");
      } else {
        toast.info("No image found for this card");
      }
    } catch (error: any) {
      console.error("Find image error:", error);
      toast.error("Failed to search for image");
    } finally {
      setIsSearching(false);
    }
  };

  const handleToggleLock = async () => {
    setIsUpdatingLock(true);
    try {
      const { error } = await supabase
        .from("cards")
        .update({ image_locked: !isLocked })
        .eq("id", cardId);

      if (error) throw error;

      setIsLocked(!isLocked);
      toast.success(isLocked ? "Image unlocked" : "Image locked");
      onImageUpdated?.();
    } catch (error: any) {
      console.error("Toggle lock error:", error);
      toast.error("Failed to update lock status");
    } finally {
      setIsUpdatingLock(false);
    }
  };

  const hasValidImage = imageUrl && !imageUrl.includes("placehold");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleFindImage}
          disabled={isSearching || isLocked}
          className="flex-1"
        >
          {isSearching ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Searching...
            </>
          ) : hasValidImage ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Re-search Image
            </>
          ) : (
            <>
              <ImagePlus className="h-4 w-4 mr-2" />
              Find Image
            </>
          )}
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isLocked ? (
            <Lock className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Unlock className="h-4 w-4 text-muted-foreground" />
          )}
          <Label htmlFor="image-lock" className="text-sm text-muted-foreground">
            Lock Image
          </Label>
        </div>
        <Switch
          id="image-lock"
          checked={isLocked}
          onCheckedChange={handleToggleLock}
          disabled={isUpdatingLock}
        />
      </div>

      {imageSource && (
        <p className="text-xs text-muted-foreground">
          Source: {imageSource}
        </p>
      )}
    </div>
  );
}
