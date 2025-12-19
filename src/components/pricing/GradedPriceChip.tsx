import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface GradedPriceChipProps {
  grader: "PSA" | "CGC" | "BGS";
  grade: string;
  price: number | null | undefined;
  currency?: string;
  className?: string;
}

export function GradedPriceChip({ 
  grader, 
  grade, 
  price, 
  currency = "USD", 
  className 
}: GradedPriceChipProps) {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  const graderColors: Record<string, string> = {
    PSA: "bg-red-500/10 text-red-500 border-red-500/20",
    CGC: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    BGS: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  };

  if (!price || price <= 0) {
    return (
      <Badge 
        variant="outline"
        className={cn(
          "text-[9px] font-medium px-1.5 py-0 text-muted-foreground border-muted-foreground/30",
          className
        )}
      >
        {grader} {grade}: —
      </Badge>
    );
  }

  return (
    <Badge 
      variant="outline"
      className={cn(
        "text-[9px] font-medium px-1.5 py-0",
        graderColors[grader] || "bg-muted text-muted-foreground",
        className
      )}
    >
      {grader} {grade}: {formatter.format(price)}
    </Badge>
  );
}
