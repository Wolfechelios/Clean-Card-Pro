import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IPhoneProCapturePanel } from "@/components/scanner/IPhoneProCapturePanel";
import { getProCaptureProfile, isProbablyIPhone, listProCaptureProfiles } from "@/lib/iphoneProCapture";
import { useScannerSettings } from "@/hooks/use-scanner-settings";
import { ArrowRight, Camera, Database, Gauge, Layers3, Radar, Repeat, ShieldCheck, Smartphone, Zap } from "lucide-react";

const workflow = [
  {
    icon: Camera,
    title: "Capture intelligently",
    text: "The scanner now changes resolution, framing guide, and capture hints based on single-card, binder, slab, foil, macro, or verify mode.",
  },
  {
    icon: Radar,
    title: "Score before lookup",
    text: "Every Pro capture receives a local focus, exposure, glare, framing, and detail score before it hits the queue.",
  },
  {
    icon: Database,
    title: "Queue offline",
    text: "Captures keep metadata in IndexedDB, so stack scans can continue even when pricing or identification is delayed.",
  },
  {
    icon: Repeat,
    title: "Verify valuable hits",
    text: "Use Macro Text Lock or Verify mode to re-check collector number, set symbol, slab label, and price confidence.",
  },
];

export default function IPhoneProScanPage() {
  const { settings, updateSettings } = useScannerSettings();
  const active = getProCaptureProfile(settings.proCaptureMode);
  const probablyIPhone = isProbablyIPhone();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1">
              <Smartphone className="h-3 w-3" /> iPhone Pro workflow
            </Badge>
            {probablyIPhone && <Badge>iPhone detected</Badge>}
          </div>
          <h1 className="text-3xl font-bold tracking-tight">iPhone 17 Pro Scanner</h1>
          <p className="max-w-3xl text-muted-foreground">
            High-detail capture profiles are wired into Rapid Scan. Choose the job, capture locally, then let the existing queue identify, price, and save cards without blocking the camera.
          </p>
        </div>
        <Button asChild>
          <Link to="/scan">
            Open scanner <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <IPhoneProCapturePanel />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {workflow.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.title}>
              <CardHeader className="pb-2">
                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-base">{item.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{item.text}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5 text-primary" />
              Active production setup
            </CardTitle>
            <CardDescription>Current scanner behavior used by Rapid Scan.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-muted-foreground">Mode</span>
              <Badge>{active.label}</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-muted-foreground">Resolution target</span>
              <span className="font-medium">{active.idealWidth}×{active.idealHeight}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-muted-foreground">Lens bias</span>
              <span className="font-medium capitalize">{active.lens.replace("_", " ")}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className="text-muted-foreground">Quality gate</span>
              <span className="font-medium">{settings.proCaptureQualityGate ? `${settings.proCaptureMinConfidence}% minimum` : "off"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Recommended shortcut mapping
            </CardTitle>
            <CardDescription>Use iOS Shortcuts / Add to Home Screen to make the app behave like a scanner appliance.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                  <Zap className="h-4 w-4 text-primary" /> Action Button
                </div>
                <p className="text-xs text-muted-foreground">Open Clean Card Pro directly to /scan, then keep Rapid mode armed.</p>
              </div>
              <div className="rounded-lg border p-3">
                <div className="mb-1 flex items-center gap-2 text-sm font-semibold">
                  <Layers3 className="h-4 w-4 text-primary" /> Binder session
                </div>
                <p className="text-xs text-muted-foreground">Switch to Binder 9-Pocket, capture full pages, then verify flagged pockets.</p>
              </div>
            </div>
            <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
              Native iOS Camera Control cannot be fully remapped from a browser/PWA, but this build now exposes the capture profiles and local quality gates needed for a Capacitor-native upgrade later.
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profiles now available</CardTitle>
          <CardDescription>These feed the scanner constraints, overlay guides, quality scoring, and queue metadata.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {listProCaptureProfiles().map((profile) => (
              <button
                key={profile.mode}
                type="button"
                onClick={() => updateSettings({ proCaptureMode: profile.mode, proCaptureEnabled: true })}
                className="rounded-xl border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{profile.label}</span>
                  {profile.mode === settings.proCaptureMode && <Badge>active</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{profile.description}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
