import { SlotCard } from "./SlotCard";
import { cn } from "@/lib/utils";

interface Card {
  id: string;
  card_name: string;
  image_url: string;
  thumbnail_url?: string;
  current_price_raw?: number;
}

interface SlotGridProps {
  cards: (Card | null)[];
  columns?: number;
  onSlotClick?: (index: number) => void;
  onCardRemove?: (cardId: string, index: number) => void;
  className?: string;
}

export function SlotGrid({
  cards,
  columns = 3,
  onSlotClick,
  onCardRemove,
  className,
}: SlotGridProps) {
  return (
    <div
      className={cn(
        "grid gap-4",
        columns === 3 && "grid-cols-3",
        columns === 4 && "grid-cols-4",
        columns === 6 && "grid-cols-6",
        columns === 9 && "grid-cols-9",
        className
      )}
    >
      {cards.map((card, index) => (
        <SlotCard
          key={card?.id || `slot-${index}`}
          cardId={card?.id}
          cardName={card?.card_name}
          imageUrl={card?.image_url}
          thumbnailUrl={card?.thumbnail_url}
          price={card?.current_price_raw}
          isEmpty={!card}
          onClick={() => onSlotClick?.(index)}
          onRemove={card ? () => onCardRemove?.(card.id, index) : undefined}
        />
      ))}
    </div>
  );
}
