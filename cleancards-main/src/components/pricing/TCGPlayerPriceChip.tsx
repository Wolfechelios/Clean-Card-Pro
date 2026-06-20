import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

interface TCGPlayerPriceChipProps {
  price: number | null | undefined;
  lowPrice?: number | null;
  midPrice?: number | null;
  highPrice?: number | null;
  marketPrice?: number | null;
  url?: string | null;
  currency?: string;
  className?: string;
}

export function TCGPlayerPriceChip({ 
  price, 
  lowPrice,
  midPrice,
  highPrice,
  marketPrice,
  url,
  currency = "USD", 
  className 
}: TCGPlayerPriceChipProps) {
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  if (!price || price <= 0) {
    return null;
  }

  const chip = (
    <Badge 
      variant="outline"
      className={cn(
        "text-[9px] font-medium px-1.5 py-0 bg-orange-500/10 text-orange-500 border-orange-500/20",
        url && "cursor-pointer hover:bg-orange-500/20",
        className
      )}
      onClick={() => {
        if (url) {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      }}
    >
      TCGPlayer: {formatter.format(price)}
      {url && <ExternalLink className="h-2.5 w-2.5 ml-1 inline" />}
    </Badge>
  );

  // Show tooltip with price breakdown if we have additional prices
  if (lowPrice || midPrice || highPrice || marketPrice) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {chip}
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            <div className="space-y-1">
              <div className="font-medium text-orange-400 mb-1">TCGPlayer Prices</div>
              {marketPrice && marketPrice > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Market:</span>
                  <span>{formatter.format(marketPrice)}</span>
                </div>
              )}
              {lowPrice && lowPrice > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Low:</span>
                  <span>{formatter.format(lowPrice)}</span>
                </div>
              )}
              {midPrice && midPrice > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Mid:</span>
                  <span>{formatter.format(midPrice)}</span>
                </div>
              )}
              {highPrice && highPrice > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">High:</span>
                  <span>{formatter.format(highPrice)}</span>
                </div>
              )}
              <div className="flex justify-between gap-3 pt-1 border-t border-border/50">
                <span className="text-muted-foreground">Last Sold:</span>
                <span className="text-orange-400 font-medium">{formatter.format(price)}</span>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return chip;
}
