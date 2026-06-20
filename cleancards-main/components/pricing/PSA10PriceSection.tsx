import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RefreshCw, Lock, Unlock, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface PSA10PriceSectionProps {
  cardId: string;
  price: number | null | undefined;
  currency?: string;
  source?: string | null;
  updatedAt?: string | null;
  confidence?: number | null;
  sourceRef?: string | null;
  locked?: boolean;
  onUpdate?: () => void;
}

export function PSA10PriceSection({
  cardId,
  price,
  currency = "USD",
  source,
  updatedAt,
  confidence,
  sourceRef,
  locked = false,
  onUpdate
}: PSA10PriceSectionProps) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLocked, setIsLocked] = useState(locked);

  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("get-psa10-price", {
        body: { card_id: cardId }
      });

      if (error) throw error;

      if (data.psa10_price) {
        toast.success(`PSA 10 price updated: ${formatter.format(data.psa10_price)}`);
      } else {
        toast.info("PSA 10 price not found for this card");
      }
      
      onUpdate?.();
    } catch (error) {
      console.error("Failed to refresh PSA10 price:", error);
      toast.error("Failed to refresh PSA 10 price");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLockToggle = async (newLocked: boolean) => {
    try {
      const { error } = await supabase
        .from("cards")
        .update({ psa10_locked: newLocked })
        .eq("id", cardId);

      if (error) throw error;

      setIsLocked(newLocked);
      toast.success(newLocked ? "Price match locked" : "Price match unlocked");
      onUpdate?.();
    } catch (error) {
      console.error("Failed to toggle lock:", error);
      toast.error("Failed to update lock status");
    }
  };

  return (
    <div className="space-y-3 p-4 rounded-lg bg-card border border-border">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">PSA 10 Price</h4>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="h-8"
        >
          <RefreshCw className={`h-4 w-4 mr-1 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-2xl font-bold text-foreground">
          {price ? formatter.format(price) : "—"}
        </span>
        {source && (
          <Badge variant="outline" className="text-xs">
            {source}
          </Badge>
        )}
        {confidence && (
          <Badge 
            variant={confidence >= 85 ? "default" : confidence >= 70 ? "secondary" : "outline"}
            className="text-xs"
          >
            {confidence}% match
          </Badge>
        )}
      </div>

      {updatedAt && (
        <p className="text-xs text-muted-foreground">
          Updated {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}
        </p>
      )}

      {sourceRef && (
        <a
          href={sourceRef}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          View source <ExternalLink className="h-3 w-3" />
        </a>
      )}

      <div className="flex items-center space-x-2 pt-2 border-t border-border">
        <Switch
          id="lock-match"
          checked={isLocked}
          onCheckedChange={handleLockToggle}
        />
        <Label htmlFor="lock-match" className="text-sm flex items-center gap-1">
          {isLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
          Lock match
        </Label>
      </div>
    </div>
  );
}
