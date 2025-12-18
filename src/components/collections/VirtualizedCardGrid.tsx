import { useRef, useMemo, useEffect, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CardThumbnail } from "./CardThumbnail";

interface CardItem {
  id: string;
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  rarity: string | null;
  image_url: string;
  thumbnail_url: string | null;
  current_price_raw: number | null;
  collection_name: string | null;
  condition: string | null;
  created_at: string;
  game_type: string | null;
  sport_type: string | null;
  psa10_price?: number | null;
  cgc10_price?: number | null;
}

interface VirtualizedCardGridProps {
  cards: CardItem[];
  selectedCards: Set<string>;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCardClick: (card: CardItem) => void;
  onRefresh?: () => void;
}

const ITEM_MIN_WIDTH = 140;
const ITEM_HEIGHT = 180; // thumbnail (140) + label area (~40)
const GAP = 8;

export function VirtualizedCardGrid({
  cards,
  selectedCards,
  onSelect,
  onDelete,
  onCardClick,
  onRefresh,
}: VirtualizedCardGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Track container width for responsive columns
  useEffect(() => {
    if (!parentRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(width);
    });

    resizeObserver.observe(parentRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Calculate columns based on container width
  const columnCount = useMemo(() => {
    if (containerWidth === 0) return 1;
    return Math.max(1, Math.floor((containerWidth + GAP) / (ITEM_MIN_WIDTH + GAP)));
  }, [containerWidth]);

  // Calculate actual item width
  const itemWidth = useMemo(() => {
    if (columnCount === 1) return containerWidth;
    return (containerWidth - GAP * (columnCount - 1)) / columnCount;
  }, [containerWidth, columnCount]);

  // Calculate rows
  const rowCount = Math.ceil(cards.length / columnCount);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT + GAP,
    overscan: 5,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();

  return (
    <div
      ref={parentRef}
      className="h-[calc(100vh-380px)] min-h-[400px] overflow-auto"
      style={{ contain: "strict" }}
    >
      <div
        className="relative w-full"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {virtualRows.map((virtualRow) => {
          const rowIndex = virtualRow.index;
          const startIndex = rowIndex * columnCount;
          const rowCards = cards.slice(startIndex, startIndex + columnCount);

          return (
            <div
              key={virtualRow.key}
              className="absolute left-0 right-0 flex"
              style={{
                top: `${virtualRow.start}px`,
                height: `${ITEM_HEIGHT}px`,
                gap: `${GAP}px`,
              }}
            >
              {rowCards.map((card, colIndex) => (
                <div
                  key={card.id}
                  style={{ width: `${itemWidth}px`, flexShrink: 0 }}
                >
                  <CardThumbnail
                    id={card.id}
                    cardName={card.card_name}
                    cardSet={card.card_set}
                    cardNumber={card.card_number}
                    imageUrl={card.image_url}
                    thumbnailUrl={card.thumbnail_url}
                    price={card.current_price_raw}
                    psa10Price={card.psa10_price}
                    cgc10Price={card.cgc10_price}
                    isSelected={selectedCards.has(card.id)}
                    gameType={card.game_type}
                    sportType={card.sport_type}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    onClick={() => onCardClick(card)}
                    onImageUpdated={onRefresh}
                  />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
