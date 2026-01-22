import { Button } from "@/components/ui/button";

export function ZoomControls({
  zoomLevel,
  zoomIn,
  zoomOut,
  resetZoom,
}: {
  zoomLevel: number;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={zoomOut}>
        –
      </Button>
      <div className="min-w-12 text-center text-xs text-muted-foreground">{zoomLevel.toFixed(1)}×</div>
      <Button size="sm" variant="outline" onClick={zoomIn}>
        +
      </Button>
      <Button size="sm" variant="ghost" onClick={resetZoom}>
        Reset
      </Button>
    </div>
  );
}
