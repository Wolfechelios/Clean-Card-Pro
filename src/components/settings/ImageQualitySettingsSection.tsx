import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScannerSettings } from "@/hooks/use-scanner-settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ImageQualitySettingsSection({
  settings,
  updateSettings,
}: {
  settings: ScannerSettings;
  updateSettings: (u: Partial<ScannerSettings>) => void;
}) {
  const mode = settings.captureQualityMode;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Image Quality</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label className="text-sm font-medium">Capture mode</Label>
          <select
            className="h-10 rounded-md border bg-background px-3 text-sm"
            value={mode}
            onChange={(e) => updateSettings({ captureQualityMode: e.target.value as any })}
          >
            <option value="rapid">Rapid (fast)</option>
            <option value="grading">Grading (best frame)</option>
          </select>
        </div>

        {mode === "rapid" ? (
          <div className="space-y-3">
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Max long edge (px)</Label>
              <input
                className="h-10 rounded-md border bg-background px-3 text-sm"
                type="number"
                min={900}
                max={2400}
                value={settings.rapidMaxLongEdge}
                onChange={(e) => updateSettings({ rapidMaxLongEdge: Number(e.target.value) })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">Prefer WebP</Label>
                <p className="text-xs text-muted-foreground">Smaller files when supported</p>
              </div>
              <Switch
                checked={!!settings.rapidPreferWebp}
                onCheckedChange={(checked) => updateSettings({ rapidPreferWebp: checked })}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Burst frames</Label>
              <input
                className="h-10 rounded-md border bg-background px-3 text-sm"
                type="number"
                min={1}
                max={12}
                value={settings.gradingBurstFrames}
                onChange={(e) => updateSettings({ gradingBurstFrames: Number(e.target.value) })}
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Min sharpness</Label>
              <input
                className="h-10 rounded-md border bg-background px-3 text-sm"
                type="number"
                min={5}
                max={200}
                value={settings.gradingMinSharpness}
                onChange={(e) => updateSettings({ gradingMinSharpness: Number(e.target.value) })}
              />
            </div>
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Output format</Label>
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={settings.gradingOutputFormat}
                onChange={(e) => updateSettings({ gradingOutputFormat: e.target.value as any })}
              >
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
                <option value="png">PNG</option>
              </select>
            </div>
            {settings.gradingOutputFormat === "jpeg" && (
              <div className="grid gap-2">
                <Label className="text-sm font-medium">JPEG quality (0.90–1.00)</Label>
                <input
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  type="number"
                  min={0.9}
                  max={1}
                  step={0.01}
                  value={settings.gradingJpegQuality}
                  onChange={(e) => updateSettings({ gradingJpegQuality: Number(e.target.value) })}
                />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
