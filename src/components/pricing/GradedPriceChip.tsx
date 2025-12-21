import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface GradedPriceChipProps {
  grader: "PSA" | "CGC" | "BGS";
  grade: string;
  price: number | null | undefined;
  medianPrice?: number | null;
  currency?: string;
  className?: string;
}

export function GradedPriceChip({ 
  grader, 
  grade, 
  price, 
  medianPrice,
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

  const chip = (
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

  // Show tooltip with median vs highest raw if median is available
  if (medianPrice && medianPrice > 0) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {chip}
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <div className="space-y-1">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Median:</span>
                <span>{formatter.format(medianPrice)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Highest Raw:</span>
                <span className="text-primary font-medium">{formatter.format(price)}</span>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return chip;
}
