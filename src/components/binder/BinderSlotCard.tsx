import { cn } from "@/lib/utils";
import type { BinderSlot } from "@/hooks/use-binder-data";
import type { BinderSettings } from "@/hooks/use-binder-settings";

interface BinderSlotCardProps {
  slot: BinderSlot;
  showPrices: boolean;
  heatmapMode: boolean;
  pictureSettings: BinderSettings;
  onClick: () => void;
}

function getHeatGlow(price: number | null): string {
  if (!price || price <= 0) return "";
  if (price < 5) return "shadow-[0_0_8px_hsl(var(--primary)/0.15)]";
  if (price < 20) return "shadow-[0_0_12px_hsl(var(--primary)/0.3)]";
  if (price < 100) return "shadow-[0_0_18px_hsl(197,80%,50%,0.4)]";
  return "shadow-[0_0_24px_hsl(197,80%,50%,0.6)]";
}

function getFoilGlow(variant: string): string {
  const v = variant.toLowerCase();
  if (v.includes("secret") || v.includes("prismatic")) return "ring-2 ring-amber-400/50 shadow-[0_0_16px_hsl(45,90%,50%,0.3)]";
  if (v.includes("holo") || v.includes("foil")) return "ring-1 ring-primary/40 shadow-[0_0_12px_hsl(var(--primary)/0.25)]";
  if (v.includes("reverse")) return "ring-1 ring-sky-400/30 shadow-[0_0_10px_hsl(200,80%,50%,0.2)]";
  return "";
}

export function BinderSlotCard({ slot, showPrices, heatmapMode, pictureSettings, onClick }: BinderSlotCardProps) {
  const heatClass = heatmapMode ? getHeatGlow(slot.rawPrice) : "";
  const foilClass = slot.owned && pictureSettings.foilGlow ? getFoilGlow(slot.variant) : "";

  const showImage = pictureSettings.imageDisplay !== "hidden";
  const imgSrc = pictureSettings.imageDisplay === "full"
    ? (slot.imageUrl || slot.thumbnailUrl)
    : (slot.thumbnailUrl || slot.imageUrl);
  const fitClass = pictureSettings.imageFit === "contain" ? "object-contain" : "object-cover";

  const renderMissing = () => {
    if (pictureSettings.missingStyle === "silhouette") {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2">
          <div className="w-2/3 h-3/5 rounded bg-muted-foreground/10 border border-muted-foreground/20" />
          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-full">
            #{slot.cardNumber}
          </span>
        </div>
      );
    }
    if (pictureSettings.missingStyle === "logo") {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2">
          <img src="/brand/logo.png" alt="Set logo" className="w-1/2 h-1/2 object-contain opacity-30" />
          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-full">
            #{slot.cardNumber}
          </span>
        </div>
      );
    }
    // "empty"
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2">
        <div className="w-8 h-10 rounded bg-muted-foreground/10 border border-dashed border-muted-foreground/20" />
        <span className="text-[10px] text-muted-foreground font-mono truncate max-w-full">
          #{slot.cardNumber}
        </span>
        <span className="text-[9px] text-muted-foreground/60 truncate max-w-full text-center leading-tight">
          {slot.cardName}
        </span>
      </div>
    );
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative aspect-[2.5/3.5] rounded-lg overflow-hidden transition-all duration-200 border",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "hover:scale-[1.03] active:scale-[0.98]",
        slot.owned ? "border-border/60 bg-card" : "border-border/30 bg-muted/30",
        heatClass,
        foilClass
      )}
    >
      {slot.owned && showImage && imgSrc ? (
        <img
          src={imgSrc}
          alt={slot.cardName}
          className={cn("absolute inset-0 w-full h-full", fitClass)}
          loading="lazy"
        />
      ) : slot.owned && !showImage ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center">
          <span className="text-[10px] text-muted-foreground font-mono">#{slot.cardNumber}</span>
          <span className="text-[11px] font-medium text-foreground leading-tight line-clamp-3">
            {slot.cardName}
          </span>
        </div>
      ) : (
        renderMissing()
      )}

      {/* Quantity badge */}
      {slot.owned && slot.quantity > 1 && (
        <span className="absolute top-1 right-1 bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
          x{slot.quantity}
        </span>
      )}

      {/* Price badge */}
      {showPrices && slot.rawPrice != null && slot.rawPrice > 0 && (
        <span className="absolute bottom-1 left-1 bg-background/80 backdrop-blur-sm text-foreground text-[10px] font-medium px-1.5 py-0.5 rounded leading-none">
          ${slot.rawPrice.toFixed(2)}
        </span>
      )}

      {/* Card name caption */}
      {slot.owned && pictureSettings.showCardName && showImage && imgSrc && (
        <span className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-background/90 to-transparent text-[10px] text-foreground font-medium truncate">
          {slot.cardName}
        </span>
      )}

      {/* Card number overlay for owned cards (only when image is showing) */}
      {slot.owned && showImage && imgSrc && !pictureSettings.showCardName && (
        <span className="absolute bottom-1 right-1 text-[9px] text-white/70 font-mono drop-shadow-sm">
          #{slot.cardNumber}
        </span>
      )}
    </button>
  );
}
