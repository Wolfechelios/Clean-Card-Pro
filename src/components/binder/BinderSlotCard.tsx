import { cn } from "@/lib/utils";
import type { BinderSlot } from "@/hooks/use-binder-data";

interface BinderSlotCardProps {
  slot: BinderSlot;
  showPrices: boolean;
  heatmapMode: boolean;
  onClick: () => void;
}

function getHeatGlow(price: number | null): string {
  if (!price || price <= 0) return "";
  if (price < 5) return "shadow-[0_0_8px_hsl(var(--primary)/0.15)]";
  if (price < 20) return "shadow-[0_0_12px_hsl(var(--primary)/0.3)]";
  if (price < 100) return "shadow-[0_0_18px_hsl(197,80%,50%,0.4)]";
  return "shadow-[0_0_24px_hsl(197,80%,50%,0.6)]";
}

export function BinderSlotCard({ slot, showPrices, heatmapMode, onClick }: BinderSlotCardProps) {
  const heatClass = heatmapMode ? getHeatGlow(slot.rawPrice) : "";

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative aspect-[2.5/3.5] rounded-lg overflow-hidden transition-all duration-200 border",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "hover:scale-[1.03] active:scale-[0.98]",
        slot.owned
          ? "border-border/60 bg-card"
          : "border-border/30 bg-muted/30",
        heatClass
      )}
    >
      {slot.owned && slot.imageUrl ? (
        <img
          src={slot.thumbnailUrl || slot.imageUrl}
          alt={slot.cardName}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2">
          <div className="w-8 h-10 rounded bg-muted-foreground/10 border border-dashed border-muted-foreground/20" />
          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-full">
            #{slot.cardNumber}
          </span>
          <span className="text-[9px] text-muted-foreground/60 truncate max-w-full text-center leading-tight">
            {slot.cardName}
          </span>
        </div>
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

      {/* Card number overlay for owned cards */}
      {slot.owned && (
        <span className="absolute bottom-1 right-1 text-[9px] text-white/70 font-mono drop-shadow-sm">
          #{slot.cardNumber}
        </span>
      )}
    </button>
  );
}
