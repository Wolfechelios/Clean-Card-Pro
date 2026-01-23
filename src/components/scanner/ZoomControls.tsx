import { Button } from "../ui/button";

export function ZoomControls(props: {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  zoomLevel: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="secondary" onClick={props.zoomOut}>
        -
      </Button>
      <div className="text-sm tabular-nums">{props.zoomLevel.toFixed(1)}×</div>
      <Button type="button" variant="secondary" onClick={props.zoomIn}>
        +
      </Button>
      <Button type="button" variant="outline" onClick={props.resetZoom}>
        Reset
      </Button>
    </div>
  );
}
