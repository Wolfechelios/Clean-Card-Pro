import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, DollarSign, TrendingUp } from "lucide-react";
import { getRecentScans, getHighValueScans, getRecentScanStats, type RecentScan } from "@/lib/recentScans";
import { cn } from "@/lib/utils";

export function RecentScansBox() {
  const [scans, setScans] = useState<RecentScan[]>([]);
  const [highValueScans, setHighValueScans] = useState<Array<RecentScan & { positionBehind: number }>>([]);
  const [stats, setStats] = useState({ totalScans: 0, highValueCount: 0, totalValue: 0 });

  useEffect(() => {
    const update = () => {
      setScans(getRecentScans());
      setHighValueScans(getHighValueScans());
      setStats(getRecentScanStats());
    };

    update();
    // Refresh every 30 seconds
    const interval = setInterval(update, 30000);
    
    // Listen for storage events (cross-tab sync)
    window.addEventListener("storage", update);
    // Custom event for same-tab updates
    window.addEventListener("recent-scan-added", update);

    return () => {
      clearInterval(interval);
      window.removeEventListener("storage", update);
      window.removeEventListener("recent-scan-added", update);
    };
  }, []);

  if (scans.length === 0) {
    return null;
  }

  const formatTime = (timestamp: number) => {
    const mins = Math.floor((Date.now() - timestamp) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          Recent Scans (Last 24 Hours)
          <Badge variant="secondary" className="ml-auto">
            {stats.totalScans}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Stats row */}
        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">$20+ cards:</span>
            <span className="font-semibold text-primary">{stats.highValueCount}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <DollarSign className="h-4 w-4 text-success" />
            <span className="text-muted-foreground">Total:</span>
            <span className="font-semibold text-success">${stats.totalValue.toFixed(2)}</span>
          </div>
        </div>

        {/* High value cards with position markers */}
        {highValueScans.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-primary">High Value Cards ($20+)</div>
            <div className="flex flex-wrap gap-1">
              {highValueScans.map((scan) => (
            <Badge
                  key={scan.id}
                  variant="outline"
                  className={cn(
                    "text-xs border-primary/50 bg-primary/10",
                    scan.positionBehind === 0 && "border-primary bg-primary/20"
                  )}
                >
                  #{scan.positionBehind + 1} • ${scan.price?.toFixed(0)}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Recent scans list */}
        <div className="max-h-64 overflow-y-auto space-y-1.5">
          {scans.slice(0, 10).map((scan, idx) => (
            <div
              key={scan.id}
              className={cn(
                "flex items-center gap-3 text-sm p-2 rounded",
                scan.isHighValue && "bg-primary/10 border border-primary/20"
              )}
            >
              {scan.image_url && (
                <img
                  src={scan.image_url}
                  alt=""
                  className="w-10 h-10 rounded object-cover shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium text-sm">
                  {scan.card_name}
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  {scan.player_name && <span>{scan.player_name}</span>}
                  {scan.player_name && scan.card_number && <span> • </span>}
                  {scan.card_number && <span>#{scan.card_number}</span>}
                  {!scan.player_name && !scan.card_number && scan.card_set && <span>{scan.card_set}</span>}
                </div>
              </div>
              <div className="text-right shrink-0">
                {scan.price !== null && (
                  <div className={cn(
                    "font-semibold text-sm",
                    scan.price >= 30 ? "text-red-500" : scan.price >= 10 ? "text-blue-500" : "text-muted-foreground"
                  )}>
                    ${scan.price.toFixed(2)}
                  </div>
                )}
                <div className="text-muted-foreground text-xs">
                  {formatTime(scan.scanned_at)}
                </div>
              </div>
              {scan.isHighValue && (
                <Badge variant="secondary" className="text-[10px] px-1.5">
                  +{idx} back
                </Badge>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
