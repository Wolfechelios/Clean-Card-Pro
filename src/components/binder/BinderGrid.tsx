import { useState, useMemo, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BinderSlotCard } from "./BinderSlotCard";
import { BinderSlotModal } from "./BinderSlotModal";
import type { BinderSlot } from "@/hooks/use-binder-data";

const SLOTS_PER_PAGE = 9; // 3x3

interface BinderGridProps {
  slots: BinderSlot[];
  showPrices: boolean;
  heatmapMode: boolean;
  flipStyle: "3d" | "slide";
}

export function BinderGrid({ slots, showPrices, heatmapMode, flipStyle }: BinderGridProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<BinderSlot | null>(null);
  const [direction, setDirection] = useState<"left" | "right">("right");
  const [animating, setAnimating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const totalPages = Math.ceil(slots.length / SLOTS_PER_PAGE);

  const pageSlots = useMemo(() => {
    const start = currentPage * SLOTS_PER_PAGE;
    return slots.slice(start, start + SLOTS_PER_PAGE);
  }, [slots, currentPage]);

  // Check near-complete pages
  const pageCompletion = useMemo(() => {
    const owned = pageSlots.filter((s) => s.owned).length;
    return { owned, total: pageSlots.length, nearComplete: owned >= pageSlots.length - 1 && pageSlots.length > 0 };
  }, [pageSlots]);

  const navigate = useCallback((dir: "left" | "right") => {
    if (animating) return;
    const next = dir === "right" ? currentPage + 1 : currentPage - 1;
    if (next < 0 || next >= totalPages) return;
    setDirection(dir);
    setAnimating(true);
    setTimeout(() => {
      setCurrentPage(next);
      setAnimating(false);
    }, 350);
  }, [currentPage, totalPages, animating]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") navigate("left");
    if (e.key === "ArrowRight") navigate("right");
  }, [navigate]);

  const getAnimClass = () => {
    if (!animating) return "";
    if (flipStyle === "slide") {
      return direction === "right"
        ? "animate-[slideOutLeft_0.35s_ease-in-out_forwards]"
        : "animate-[slideOutRight_0.35s_ease-in-out_forwards]";
    }
    // 3D page turn
    return direction === "right"
      ? "animate-[pageTurnRight_0.35s_ease-in-out_forwards]"
      : "animate-[pageTurnLeft_0.35s_ease-in-out_forwards]";
  };

  return (
    <div
      ref={containerRef}
      className="relative focus:outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Page indicator */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground font-medium">
            Page {currentPage + 1} of {totalPages || 1}
          </span>
          {pageCompletion.nearComplete && pageCompletion.total > 0 && (
            <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary border-primary/20">
              {pageCompletion.owned === pageCompletion.total ? "Complete!" : "Almost!"}
            </Badge>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          #{pageSlots[0]?.cardNumber || "—"} – #{pageSlots[pageSlots.length - 1]?.cardNumber || "—"}
        </span>
      </div>

      {/* Binder page */}
      <div className={cn(
        "relative rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm p-3 sm:p-4",
        "shadow-sm",
        pageCompletion.nearComplete && pageCompletion.total > 0 && "ring-1 ring-primary/20"
      )}>
        <div
          className={cn(
            "grid grid-cols-3 gap-2 sm:gap-3",
            "[perspective:1200px]",
            getAnimClass()
          )}
        >
          {pageSlots.map((slot) => (
            <BinderSlotCard
              key={`${slot.setId}-${slot.cardNumber}-${slot.variant}`}
              slot={slot}
              showPrices={showPrices}
              heatmapMode={heatmapMode}
              onClick={() => setSelectedSlot(slot)}
            />
          ))}
          {/* Fill empty slots to maintain 3x3 */}
          {pageSlots.length < SLOTS_PER_PAGE &&
            Array.from({ length: SLOTS_PER_PAGE - pageSlots.length }).map((_, i) => (
              <div key={`empty-${i}`} className="aspect-[2.5/3.5] rounded-lg bg-muted/10 border border-dashed border-border/20" />
            ))}
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-center gap-3 mt-4">
        <Button
          variant="outline"
          size="icon"
          onClick={() => navigate("left")}
          disabled={currentPage === 0 || animating}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {/* Page dots (max 10 visible) */}
        <div className="flex items-center gap-1">
          {Array.from({ length: Math.min(totalPages, 10) }).map((_, i) => {
            const pageIndex = totalPages <= 10 ? i : Math.round((i / 9) * (totalPages - 1));
            return (
              <button
                key={i}
                onClick={() => { setCurrentPage(pageIndex); }}
                className={cn(
                  "w-2 h-2 rounded-full transition-all",
                  pageIndex === currentPage ? "bg-primary w-4" : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                )}
              />
            );
          })}
        </div>

        <Button
          variant="outline"
          size="icon"
          onClick={() => navigate("right")}
          disabled={currentPage >= totalPages - 1 || animating}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Slot modal */}
      {selectedSlot && (
        <BinderSlotModal slot={selectedSlot} onClose={() => setSelectedSlot(null)} />
      )}
    </div>
  );
}
