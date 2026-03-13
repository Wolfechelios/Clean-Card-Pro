import { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Cpu, Wifi, WifiOff, Loader2, CheckCircle2,
  Eye, ScanLine, Crop, Binary, Radio, Activity,
} from "lucide-react";
import { toast } from "sonner";
import { useScannerSettings } from "@/hooks/use-scanner-settings";
import {
  jetsonHealth,
  type JetsonHealth,
} from "@/lib/jetsonClient";

interface EndpointStatus {
  status: "idle" | "testing" | "ok" | "fail";
  detail?: string;
  latency?: number;
}

const ENDPOINTS = [
  { key: "health",    path: "/health",    label: "Health Check",     icon: Activity, method: "GET",  desc: "Confirms Jetson is alive, GPU active, model loaded" },
  { key: "infer",     path: "/infer",     label: "Image Inference",  icon: Eye,      method: "POST", desc: "Card detection, bounding box, OCR, classification" },
  { key: "ocr",       path: "/ocr",       label: "OCR",              icon: ScanLine, method: "POST", desc: "Text extraction from cropped card images" },
  { key: "rectify",   path: "/rectify",   label: "Perspective Fix",  icon: Crop,     method: "POST", desc: "Straighten skewed cards before recognition" },
  { key: "embedding", path: "/embedding", label: "Embedding",        icon: Binary,   method: "POST", desc: "Vector embedding for image similarity matching" },
  { key: "stream",    path: "/stream",    label: "Live Stream (WS)", icon: Radio,    method: "WS",   desc: "Continuous detection for live camera scanning" },
] as const;

export function JetsonInferenceSettings() {
  const { settings, updateSettings } = useScannerSettings();
  const [healthData, setHealthData] = useState<JetsonHealth | null>(null);
  const [endpointStatuses, setEndpointStatuses] = useState<Record<string, EndpointStatus>>({});

  const getBaseUrl = useCallback(() => {
    const ip = settings.orinServerUrl || "192.168.1.37";
    const base = ip.startsWith("http") ? ip : `http://${ip}`;
    return base.includes(":8") ? base : `${base}:8000`;
  }, [settings.orinServerUrl]);

  const setEpStatus = (key: string, s: EndpointStatus) =>
    setEndpointStatuses((prev) => ({ ...prev, [key]: s }));

  const handleHealthCheck = async () => {
    setEpStatus("health", { status: "testing" });
    try {
      const start = performance.now();
      const data = await jetsonHealth(settings.orinTimeoutMs || 15000);
      const latency = Math.round(performance.now() - start);
      setHealthData(data);
      setEpStatus("health", { status: "ok", detail: `GPU: ${data.gpu}, model: ${data.model_loaded ? "loaded" : "not loaded"}`, latency });
      toast.success(`Jetson alive — ${latency}ms`);
    } catch (err: any) {
      setEpStatus("health", { status: "fail", detail: err.name === "AbortError" ? "Timed out" : err.message });
      setHealthData(null);
      toast.error(`Health check failed: ${err.message}`);
    }
  };

  const handleTestEndpoint = async (key: string, path: string) => {
    if (key === "health") return handleHealthCheck();
    if (key === "stream") {
      // WS test — just try to connect
      setEpStatus(key, { status: "testing" });
      const wsBase = getBaseUrl().replace(/^http/, "ws");
      const ws = new WebSocket(`${wsBase}${path}`);
      const timeout = setTimeout(() => { ws.close(); setEpStatus(key, { status: "fail", detail: "Timed out" }); }, 5000);
      ws.onopen = () => { clearTimeout(timeout); setEpStatus(key, { status: "ok", detail: "WebSocket connected" }); ws.close(); toast.success("Stream endpoint reachable"); };
      ws.onerror = () => { clearTimeout(timeout); setEpStatus(key, { status: "fail", detail: "WebSocket refused" }); toast.error("Stream connection failed"); };
      return;
    }

    // POST endpoints — send a tiny test image
    setEpStatus(key, { status: "testing" });
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#888";
      ctx.fillRect(0, 0, 64, 64);
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/jpeg", 0.5));

      const fd = new FormData();
      fd.append("file", blob, "test.jpg");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), settings.orinTimeoutMs || 15000);
      const start = performance.now();
      const res = await fetch(`${getBaseUrl()}${path}`, { method: "POST", body: fd, signal: ctrl.signal });
      clearTimeout(timer);
      const latency = Math.round(performance.now() - start);

      if (res.ok) {
        setEpStatus(key, { status: "ok", detail: `${latency}ms`, latency });
        toast.success(`${path} responded in ${latency}ms`);
      } else {
        setEpStatus(key, { status: "fail", detail: `HTTP ${res.status}` });
        toast.error(`${path} returned ${res.status}`);
      }
    } catch (err: any) {
      setEpStatus(key, { status: "fail", detail: err.name === "AbortError" ? "Timed out" : err.message });
      toast.error(`${path} failed: ${err.message}`);
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
        <CardDescription>
          Choose between cloud/local AI or a dedicated Jetson inference server.
          Jetson handles vision compute only — no DB, pricing, or business logic.
        </CardDescription>
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
          <div className="space-y-5 pt-3 border-t border-border">
            {/* Connection Settings */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="text-sm font-medium">Jetson IP Address</Label>
                <Input
                  value={settings.orinServerUrl}
                  onChange={(e) => updateSettings({ orinServerUrl: e.target.value })}
                  placeholder="192.168.1.37"
                />
                <p className="text-xs text-muted-foreground">Port 8000 assumed if not specified</p>
              </div>
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
            </div>

            {/* Base URL preview */}
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Base URL</p>
              <p className="text-sm font-mono break-all">{getBaseUrl()}</p>
            </div>

            <Separator />

            {/* Endpoint Grid */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Endpoints</h3>
              <div className="grid gap-3">
                {ENDPOINTS.map((ep) => {
                  const s = endpointStatuses[ep.key] || { status: "idle" };
                  const Icon = ep.icon;
                  return (
                    <div
                      key={ep.key}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{ep.label}</span>
                            <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                              {ep.method} {ep.path}
                            </Badge>
                            {s.status === "ok" && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-500/10 text-green-600 border-green-500/20">
                                {s.latency ? `${s.latency}ms` : "OK"}
                              </Badge>
                            )}
                            {s.status === "fail" && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                                Failed
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{ep.desc}</p>
                          {s.detail && s.status !== "idle" && (
                            <p className={`text-xs mt-1 ${s.status === "ok" ? "text-green-600" : "text-destructive"}`}>
                              {s.detail}
                            </p>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleTestEndpoint(ep.key, ep.path)}
                        disabled={s.status === "testing"}
                        className="shrink-0"
                      >
                        {s.status === "testing" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : s.status === "ok" ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : s.status === "fail" ? (
                          <WifiOff className="h-4 w-4 text-destructive" />
                        ) : (
                          <Wifi className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Health detail card */}
            {healthData && (
              <>
                <Separator />
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground">Last Health Response</p>
                  <pre className="text-xs font-mono whitespace-pre-wrap text-foreground">
                    {JSON.stringify(healthData, null, 2)}
                  </pre>
                </div>
              </>
            )}

            <Separator />

            {/* Priority toggles */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Routing Priority</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Use for queue</Label>
                    <p className="text-xs text-muted-foreground">Rapid Scan queue routes to Jetson</p>
                  </div>
                  <Switch
                    checked={settings.orinPreferForQueue}
                    onCheckedChange={(c) => updateSettings({ orinPreferForQueue: c })}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">Use for live</Label>
                    <p className="text-xs text-muted-foreground">Live viewfinder streams to Jetson</p>
                  </div>
                  <Switch
                    checked={settings.orinPreferForLive}
                    onCheckedChange={(c) => updateSettings({ orinPreferForLive: c })}
                  />
                </div>
              </div>
            </div>

            {/* Test All button */}
            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                for (const ep of ENDPOINTS) {
                  await handleTestEndpoint(ep.key, ep.path);
                }
              }}
            >
              <Activity className="h-4 w-4 mr-2" />
              Test All Endpoints
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
