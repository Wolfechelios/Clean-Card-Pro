import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Cpu, Search, CheckCircle2, XCircle, Loader2,
  Wifi, Settings2, Activity, Terminal,
} from "lucide-react";
import { useJetsonAutoSetup, type SetupPhase } from "@/hooks/use-jetson-auto-setup";

const PHASE_INFO: Record<SetupPhase, { label: string; icon: typeof Cpu; color: string }> = {
  idle:          { label: "Ready to scan",     icon: Wifi,         color: "text-muted-foreground" },
  scanning:      { label: "Scanning network",  icon: Search,       color: "text-blue-500" },
  found:         { label: "Jetson found",       icon: CheckCircle2, color: "text-green-500" },
  configuring:   { label: "Configuring",        icon: Settings2,    color: "text-amber-500" },
  "health-check":{ label: "Health check",       icon: Activity,     color: "text-amber-500" },
  ready:         { label: "Connected",          icon: CheckCircle2, color: "text-green-500" },
  failed:        { label: "Not found",          icon: XCircle,      color: "text-destructive" },
};

export function JetsonAutoSetupWizard() {
  const { state, scan, cancel, reset } = useJetsonAutoSetup();
  const [manualIp, setManualIp] = useState("");
  const phaseInfo = PHASE_INFO[state.phase];
  const PhaseIcon = phaseInfo.icon;
  const isActive = ["scanning", "found", "configuring", "health-check"].includes(state.phase);

  return (
    <Card className="bg-card border-border">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-5 w-5" />
          Auto Setup — Vision Coprocessor
        </CardTitle>
        <CardDescription>
          Automatically discover and configure a Jetson inference server on your network.
          Both sides are configured with one click.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status badge */}
        <div className="flex items-center gap-3">
          <PhaseIcon className={`h-5 w-5 ${phaseInfo.color} ${isActive ? "animate-pulse" : ""}`} />
          <span className={`text-sm font-medium ${phaseInfo.color}`}>{phaseInfo.label}</span>
          {state.foundIp && (
            <Badge variant="secondary" className="text-xs font-mono">
              {state.foundIp}
            </Badge>
          )}
          {state.discover && (
            <Badge variant="outline" className="text-xs">
              v{state.discover.version}
            </Badge>
          )}
        </div>

        {/* Progress */}
        {isActive && (
          <div className="space-y-1">
            <Progress value={state.progress} className="h-2" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {state.phase === "scanning"
                  ? `Scanned ${state.scannedCount} / ${state.totalToScan || "..."}`
                  : phaseInfo.label}
              </span>
              <span>{state.progress}%</span>
            </div>
          </div>
        )}

        {/* Ready state — show discover info */}
        {state.phase === "ready" && state.discover && (
          <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 space-y-2">
            <p className="text-sm font-medium text-green-600">
              ✓ Vision coprocessor configured successfully
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <span>Hostname:</span>
              <span className="font-mono">{state.discover.hostname}</span>
              <span>Address:</span>
              <span className="font-mono">{state.discover.base_url}</span>
              <span>Endpoints:</span>
              <span>{state.discover.endpoints.length} available</span>
              {state.health && (
                <>
                  <span>GPU:</span>
                  <span>{state.health.gpu}</span>
                  <span>Models:</span>
                  <span>{state.health.model_loaded ? "Loaded" : "Pending"}</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Failed state */}
        {state.phase === "failed" && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
            <p className="text-sm text-destructive">{state.error}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Make sure the Jetson is powered on, connected to the same network, and bootstrap.sh has been run.
            </p>
          </div>
        )}

        {/* Controls */}
        <div className="flex gap-2 flex-wrap">
          {!isActive && (
            <>
              <Button onClick={() => scan()} size="sm">
                <Search className="h-4 w-4 mr-2" />
                Auto-Discover
              </Button>
              <div className="flex gap-1">
                <Input
                  placeholder="Or enter IP manually"
                  value={manualIp}
                  onChange={(e) => setManualIp(e.target.value)}
                  className="w-44 h-9 text-sm font-mono"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => scan(manualIp || undefined)}
                  disabled={!manualIp}
                >
                  Connect
                </Button>
              </div>
            </>
          )}
          {isActive && (
            <Button variant="destructive" size="sm" onClick={cancel}>
              Cancel
            </Button>
          )}
          {(state.phase === "ready" || state.phase === "failed") && (
            <Button variant="outline" size="sm" onClick={reset}>
              Reset
            </Button>
          )}
        </div>

        {/* Log console */}
        {state.log.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Terminal className="h-3 w-3" />
              <span>Setup log</span>
            </div>
            <ScrollArea className="h-32 rounded-md border border-border bg-muted/30 p-2">
              {state.log.map((line, i) => (
                <p key={i} className="text-[11px] font-mono text-muted-foreground leading-relaxed">
                  {line}
                </p>
              ))}
            </ScrollArea>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
