import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Cpu, Wifi, WifiOff, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useScannerSettings, type ScannerSettings } from "@/hooks/use-scanner-settings";

export function JetsonInferenceSettings() {
  const { settings, updateSettings } = useScannerSettings();
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testResult, setTestResult] = useState<string | null>(null);

  const baseUrl = settings.orinServerUrl.startsWith("http")
    ? settings.orinServerUrl
    : `http://${settings.orinServerUrl}`;
  const fullUrl = `${baseUrl.includes(":8") ? baseUrl : `${baseUrl}:8000`}${settings.orinEndpoint || "/infer"}`;

  const handleTestConnection = async () => {
    setTestStatus("testing");
    setTestResult(null);
    try {
      const healthUrl = `${baseUrl.includes(":8") ? baseUrl : `${baseUrl}:8000`}/health`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), settings.orinTimeoutMs || 15000);
      const res = await fetch(healthUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        setTestStatus("ok");
        setTestResult("Connected successfully");
        toast.success("Jetson server is reachable!");
      } else {
        setTestStatus("fail");
        setTestResult(`Server returned ${res.status}`);
        toast.error(`Server returned ${res.status}`);
      }
    } catch (err: any) {
      setTestStatus("fail");
      const msg = err.name === "AbortError" ? "Connection timed out" : err.message;
      setTestResult(msg);
      toast.error(`Connection failed: ${msg}`);
    }
  };

  const isJetson = settings.visionProvider === "jetson";

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-5 w-5" />
          Vision Provider
        </CardTitle>
        <CardDescription>Choose between cloud/local AI or a dedicated Jetson inference server</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Provider Toggle */}
        <div className="flex gap-2">
          <Button
            variant={!isJetson ? "default" : "outline"}
            size="sm"
            onClick={() => updateSettings({ visionProvider: "local", orinEnabled: false })}
          >
            Local / Cloud
          </Button>
          <Button
            variant={isJetson ? "default" : "outline"}
            size="sm"
            onClick={() => updateSettings({ visionProvider: "jetson", orinEnabled: true })}
          >
            Jetson
          </Button>
        </div>

        {isJetson && (
          <div className="space-y-4 pt-2 border-t border-border">
            {/* Jetson IP */}
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Jetson IP Address</Label>
              <Input
                value={settings.orinServerUrl}
                onChange={(e) => updateSettings({ orinServerUrl: e.target.value })}
                placeholder="192.168.1.37"
              />
              <p className="text-xs text-muted-foreground">
                IP or hostname of your Jetson device (port 8000 assumed if not specified)
              </p>
            </div>

            {/* Endpoint */}
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Inference Endpoint</Label>
              <Input
                value={settings.orinEndpoint}
                onChange={(e) => updateSettings({ orinEndpoint: e.target.value })}
                placeholder="/infer"
              />
              <p className="text-xs text-muted-foreground">
                Path on the Jetson server (e.g. <span className="font-mono">/infer</span> or <span className="font-mono">/scan</span>)
              </p>
            </div>

            {/* Timeout */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">
                Timeout: {(settings.orinTimeoutMs / 1000).toFixed(1)}s
              </Label>
              <Slider
                min={3000}
                max={60000}
                step={1000}
                value={[settings.orinTimeoutMs]}
                onValueChange={(v) => updateSettings({ orinTimeoutMs: v[0] })}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>3s</span>
                <span>60s</span>
              </div>
            </div>

            <Separator />

            {/* Priority toggles */}
            <div className="grid md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Use for queue</Label>
                  <p className="text-xs text-muted-foreground">Rapid Scan queue uses Jetson</p>
                </div>
                <Switch
                  checked={settings.orinPreferForQueue}
                  onCheckedChange={(checked) => updateSettings({ orinPreferForQueue: checked })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-sm font-medium">Use for live</Label>
                  <p className="text-xs text-muted-foreground">Live viewfinder uses Jetson</p>
                </div>
                <Switch
                  checked={settings.orinPreferForLive}
                  onCheckedChange={(checked) => updateSettings({ orinPreferForLive: checked })}
                />
              </div>
            </div>

            <Separator />

            {/* Full URL preview + test */}
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
              <p className="text-xs text-muted-foreground">Full inference URL:</p>
              <p className="text-sm font-mono break-all">{fullUrl}</p>
            </div>

            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={testStatus === "testing"}
              className="w-full"
            >
              {testStatus === "testing" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : testStatus === "ok" ? (
                <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
              ) : testStatus === "fail" ? (
                <WifiOff className="h-4 w-4 mr-2 text-destructive" />
              ) : (
                <Wifi className="h-4 w-4 mr-2" />
              )}
              Test Connection
            </Button>

            {testResult && (
              <p className={`text-xs ${testStatus === "ok" ? "text-green-500" : "text-destructive"}`}>
                {testResult}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
