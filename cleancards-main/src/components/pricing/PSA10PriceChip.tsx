import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PSA10PriceChipProps {
  price: number | null | undefined;
  currency?: string;
  className?: string;
}

export function PSA10PriceChip({ price, currency = "USD", className }: PSA10PriceChipProps) {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  if (!price) {
    return (
      <Badge 
        variant="outline" 
        className={cn("text-xs text-muted-foreground", className)}
      >
        PSA10: —
      </Badge>
    );
  }

  return (
    <Badge 
      variant="secondary"
      className={cn("text-xs font-medium", className)}
    >
      PSA10: {formatter.format(price)}
    </Badge>
  );
}
