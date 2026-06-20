import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Calculator, DollarSign, TrendingUp, TrendingDown, Info, Package, Percent } from "lucide-react";
import { cn } from "@/lib/utils";

type Marketplace = "ebay" | "tcgplayer" | "whatnot" | "mercari" | "facebook";

interface MarketplaceFees {
  name: string;
  sellerFeePercent: number;
  paymentFeePercent: number;
  paymentFeeFlat: number;
  promotedListingPercent?: number;
  notes: string;
}

const MARKETPLACE_FEES: Record<Marketplace, MarketplaceFees> = {
  ebay: {
    name: "eBay",
    sellerFeePercent: 13.25,
    paymentFeePercent: 0,
    paymentFeeFlat: 0.30,
    promotedListingPercent: 3,
    notes: "13.25% final value fee + $0.30 per order. Promoted listings optional.",
  },
  tcgplayer: {
    name: "TCGPlayer",
    sellerFeePercent: 10.25,
    paymentFeePercent: 2.5,
    paymentFeeFlat: 0.30,
    notes: "10.25% seller fee + 2.5% + $0.30 payment processing.",
  },
  whatnot: {
    name: "Whatnot",
    sellerFeePercent: 9.9,
    paymentFeePercent: 2.9,
    paymentFeeFlat: 0.30,
    notes: "9.9% seller fee + 2.9% + $0.30 payment fee.",
  },
  mercari: {
    name: "Mercari",
    sellerFeePercent: 10,
    paymentFeePercent: 2.9,
    paymentFeeFlat: 0.50,
    notes: "10% seller fee + 2.9% + $0.50 payment processing.",
  },
  facebook: {
    name: "Facebook Marketplace",
    sellerFeePercent: 0,
    paymentFeePercent: 0,
    paymentFeeFlat: 0,
    notes: "No selling fees for local pickup. Shipping protection may apply.",
  },
};

interface ResaleProfitCalculatorProps {
  initialSalePrice?: number;
  initialCost?: number;
  className?: string;
}

export function ResaleProfitCalculator({
  initialSalePrice = 0,
  initialCost = 0,
  className,
}: ResaleProfitCalculatorProps) {
  const [salePrice, setSalePrice] = useState(initialSalePrice);
  const [costBasis, setCostBasis] = useState(initialCost);
  const [shippingCost, setShippingCost] = useState(5);
  const [shippingCharged, setShippingCharged] = useState(0);
  const [marketplace, setMarketplace] = useState<Marketplace>("ebay");
  const [usePromotedListing, setUsePromotedListing] = useState(false);
  const [gradingCost, setGradingCost] = useState(0);

  const fees = MARKETPLACE_FEES[marketplace];

  const calculations = useMemo(() => {
    const totalRevenue = salePrice + shippingCharged;

    // Seller fee (on sale price only for most platforms)
    const sellerFee = (salePrice * fees.sellerFeePercent) / 100;

    // Payment processing fee (on total including shipping)
    const paymentFee = (totalRevenue * fees.paymentFeePercent) / 100 + fees.paymentFeeFlat;

    // Promoted listing fee (optional)
    const promotedFee = usePromotedListing && fees.promotedListingPercent
      ? (salePrice * fees.promotedListingPercent) / 100
      : 0;

    // Total fees
    const totalFees = sellerFee + paymentFee + promotedFee;
    const totalFeesPercent = totalRevenue > 0 ? (totalFees / totalRevenue) * 100 : 0;

    // Total costs
    const totalCosts = costBasis + shippingCost + gradingCost;

    // Net payout (what you receive after fees)
    const netPayout = totalRevenue - totalFees;

    // Net profit (after all costs)
    const netProfit = netPayout - totalCosts;

    // Profit margin
    const profitMargin = salePrice > 0 ? (netProfit / salePrice) * 100 : 0;

    // ROI (Return on Investment)
    const roi = totalCosts > 0 ? (netProfit / totalCosts) * 100 : 0;

    // Break-even price (what you need to sell for to break even)
    const effectiveFeeRate = fees.sellerFeePercent / 100 + fees.paymentFeePercent / 100;
    const breakEvenPrice = totalCosts > 0
      ? (totalCosts + fees.paymentFeeFlat + (usePromotedListing && fees.promotedListingPercent ? 0 : 0)) / (1 - effectiveFeeRate - (usePromotedListing && fees.promotedListingPercent ? fees.promotedListingPercent / 100 : 0)) - shippingCharged
      : 0;

    return {
      totalRevenue,
      sellerFee,
      paymentFee,
      promotedFee,
      totalFees,
      totalFeesPercent,
      totalCosts,
      netPayout,
      netProfit,
      profitMargin,
      roi,
      breakEvenPrice: Math.max(0, breakEvenPrice),
    };
  }, [salePrice, costBasis, shippingCost, shippingCharged, gradingCost, fees, usePromotedListing]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const isProfitable = calculations.netProfit > 0;

  return (
    <Card className={cn("glass", className)}>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-2">
          <Calculator className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Resale Profit Calculator</CardTitle>
        </div>
        <CardDescription>Calculate fees, costs, and net profit across marketplaces</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Marketplace Selection */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Marketplace</Label>
          <Select value={marketplace} onValueChange={(v) => setMarketplace(v as Marketplace)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(MARKETPLACE_FEES).map(([key, value]) => (
                <SelectItem key={key} value={key}>
                  <div className="flex items-center gap-2">
                    <span>{value.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ({value.sellerFeePercent}% + {value.paymentFeePercent}%)
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{fees.notes}</p>
        </div>

        {/* Input Grid */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="salePrice" className="text-xs text-muted-foreground flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              Sale Price
            </Label>
            <Input
              id="salePrice"
              type="number"
              min={0}
              step={0.01}
              value={salePrice || ""}
              onChange={(e) => setSalePrice(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="costBasis" className="text-xs text-muted-foreground flex items-center gap-1">
              <Package className="h-3 w-3" />
              Cost Basis (What you paid)
            </Label>
            <Input
              id="costBasis"
              type="number"
              min={0}
              step={0.01}
              value={costBasis || ""}
              onChange={(e) => setCostBasis(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="shippingCost" className="text-xs text-muted-foreground">
              Shipping Cost (Your cost)
            </Label>
            <Input
              id="shippingCost"
              type="number"
              min={0}
              step={0.01}
              value={shippingCost || ""}
              onChange={(e) => setShippingCost(parseFloat(e.target.value) || 0)}
              placeholder="5.00"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="shippingCharged" className="text-xs text-muted-foreground">
              Shipping Charged to Buyer
            </Label>
            <Input
              id="shippingCharged"
              type="number"
              min={0}
              step={0.01}
              value={shippingCharged || ""}
              onChange={(e) => setShippingCharged(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="gradingCost" className="text-xs text-muted-foreground">
              Grading Cost (if applicable)
            </Label>
            <Input
              id="gradingCost"
              type="number"
              min={0}
              step={0.01}
              value={gradingCost || ""}
              onChange={(e) => setGradingCost(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
            />
          </div>

          {fees.promotedListingPercent && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Percent className="h-3 w-3" />
                Promoted Listing ({fees.promotedListingPercent}%)
              </Label>
              <div className="flex items-center gap-2 h-10">
                <Switch
                  checked={usePromotedListing}
                  onCheckedChange={setUsePromotedListing}
                />
                <span className="text-sm text-muted-foreground">
                  {usePromotedListing ? "Enabled" : "Disabled"}
                </span>
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* Fee Breakdown */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium">Fee Breakdown</h4>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs max-w-48">Fees are calculated based on {fees.name}'s current fee structure.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          <div className="rounded-lg border p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Seller Fee ({fees.sellerFeePercent}%)</span>
              <span className="text-red-400">-{formatCurrency(calculations.sellerFee)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Payment Fee ({fees.paymentFeePercent}% + {formatCurrency(fees.paymentFeeFlat)})
              </span>
              <span className="text-red-400">-{formatCurrency(calculations.paymentFee)}</span>
            </div>
            {usePromotedListing && fees.promotedListingPercent && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Promoted Listing ({fees.promotedListingPercent}%)</span>
                <span className="text-red-400">-{formatCurrency(calculations.promotedFee)}</span>
              </div>
            )}
            <Separator className="my-2" />
            <div className="flex justify-between font-medium">
              <span>Total Fees</span>
              <span className="text-red-400">
                -{formatCurrency(calculations.totalFees)}
                <span className="text-xs text-muted-foreground ml-1">
                  ({calculations.totalFeesPercent.toFixed(1)}%)
                </span>
              </span>
            </div>
          </div>
        </div>

        {/* Profit Summary */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Profit Summary</h4>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">Net Payout</div>
              <div className="text-lg font-semibold">{formatCurrency(calculations.netPayout)}</div>
              <div className="text-xs text-muted-foreground">After marketplace fees</div>
            </div>

            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">Total Costs</div>
              <div className="text-lg font-semibold text-orange-400">{formatCurrency(calculations.totalCosts)}</div>
              <div className="text-xs text-muted-foreground">Cost + shipping + grading</div>
            </div>
          </div>

          {/* Net Profit Highlight */}
          <div className={cn(
            "rounded-xl border-2 p-4 text-center",
            isProfitable ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"
          )}>
            <div className="flex items-center justify-center gap-2 mb-1">
              {isProfitable ? (
                <TrendingUp className="h-5 w-5 text-green-500" />
              ) : (
                <TrendingDown className="h-5 w-5 text-red-500" />
              )}
              <span className="text-sm font-medium text-muted-foreground">Net Profit</span>
            </div>
            <div className={cn(
              "text-2xl font-bold",
              isProfitable ? "text-green-500" : "text-red-500"
            )}>
              {isProfitable ? "+" : ""}{formatCurrency(calculations.netProfit)}
            </div>

            <div className="flex justify-center gap-4 mt-3">
              <Badge variant="outline" className={cn(
                "text-xs",
                calculations.profitMargin >= 20 ? "border-green-500/30 text-green-500" :
                calculations.profitMargin >= 0 ? "border-yellow-500/30 text-yellow-500" :
                "border-red-500/30 text-red-500"
              )}>
                {calculations.profitMargin.toFixed(1)}% margin
              </Badge>
              <Badge variant="outline" className={cn(
                "text-xs",
                calculations.roi >= 50 ? "border-green-500/30 text-green-500" :
                calculations.roi >= 0 ? "border-yellow-500/30 text-yellow-500" :
                "border-red-500/30 text-red-500"
              )}>
                {calculations.roi.toFixed(0)}% ROI
              </Badge>
            </div>
          </div>

          {/* Break-even Price */}
          {calculations.totalCosts > 0 && (
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">Break-even Price</div>
                  <div className="text-sm font-medium">{formatCurrency(calculations.breakEvenPrice)}</div>
                </div>
                <Badge variant="secondary" className="text-xs">
                  Min to profit
                </Badge>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
