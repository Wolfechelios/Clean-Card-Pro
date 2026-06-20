import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import type { BinderSet } from "@/hooks/use-binder-data";

interface BinderControlsProps {
  sets: BinderSet[];
  selectedSetId: string | null;
  onSetChange: (id: string) => void;
  showMissingOnly: boolean;
  onShowMissingOnly: (v: boolean) => void;
  showPrices: boolean;
  onShowPrices: (v: boolean) => void;
  showVariants: boolean;
  onShowVariants: (v: boolean) => void;
  heatmapMode: boolean;
  onHeatmapMode: (v: boolean) => void;
  flipStyle: "3d" | "slide";
  onFlipStyle: (v: "3d" | "slide") => void;
  stats: { total: number; owned: number; completion: number; totalValue: number };
}

export function BinderControls({
  sets, selectedSetId, onSetChange,
  showMissingOnly, onShowMissingOnly,
  showPrices, onShowPrices,
  showVariants, onShowVariants,
  heatmapMode, onHeatmapMode,
  flipStyle, onFlipStyle,
  stats,
}: BinderControlsProps) {
  return (
    <div className="space-y-4">
      {/* Set selector */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Set</Label>
        <Select value={selectedSetId || ""} onValueChange={onSetChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a set…" />
          </SelectTrigger>
          <SelectContent>
            {sets.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.set_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      {selectedSetId && stats.total > 0 && (
        <div className="space-y-2 p-3 rounded-lg bg-card border border-border/60">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Completion</span>
            <span className="font-semibold text-foreground">{stats.owned}/{stats.total} ({stats.completion}%)</span>
          </div>
          <Progress value={stats.completion} className="h-2" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Collection Value</span>
            <span className="font-medium text-foreground">${stats.totalValue.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Toggles */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="missing" className="text-sm">Show Missing Only</Label>
          <Switch id="missing" checked={showMissingOnly} onCheckedChange={onShowMissingOnly} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="prices" className="text-sm">Show Prices</Label>
          <Switch id="prices" checked={showPrices} onCheckedChange={onShowPrices} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="variants" className="text-sm">Show Variants</Label>
          <Switch id="variants" checked={showVariants} onCheckedChange={onShowVariants} />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="heatmap" className="text-sm">Heatmap Mode</Label>
          <Switch id="heatmap" checked={heatmapMode} onCheckedChange={onHeatmapMode} />
        </div>
      </div>

      {/* Page flip style */}
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Page Transition</Label>
        <Select value={flipStyle} onValueChange={(v) => onFlipStyle(v as "3d" | "slide")}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="3d">3D Page Turn</SelectItem>
            <SelectItem value="slide">Horizontal Slide</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
