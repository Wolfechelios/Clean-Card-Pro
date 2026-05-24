import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useScannerSettings } from "@/hooks/use-scanner-settings";
import {
  getCaptureModeBadge,
  getProCaptureProfile,
  isProbablyIPhone,
  listProCaptureProfiles,
  type CaptureConfidenceBreakdown,
  type ProCaptureMode,
} from "@/lib/iphoneProCapture";
import { Camera, CheckCircle2, Cpu, Layers3, Radar, ScanLine, ShieldCheck, Smartphone, Sparkles, Zap } from "lucide-react";

interface IPhoneProCapturePanelProps {
  compact?: boolean;
  lastQuality?: CaptureConfidenceBreakdown | null;
  className?: string;
}

const modeIcon: Record<ProCaptureMode, typeof Camera> = {
  rapid: Zap,
  single: ScanLine,
  binder_9: Layers3,
  foil: Sparkles,
  macro_text: Radar,
  slab: ShieldCheck,
  verify: CheckCircle2,
};

const lensOptions = [
  { value: "auto", label: "Auto by mode" },
  { value: "main_48mp", label: "Main / Wide" },
  { value: "ultra_wide", label: "Ultra Wide" },
  { value: "telephoto", label: "Telephoto" },
  { value: "macro", label: "Macro/Text" },
] as const;

const orientationOptions = [
  { value: "portrait", label: "Portrait lock" },
  { value: "landscape", label: "Landscape lock" },
  { value: "auto", label: "Auto by mode" },
] as const;

function confidenceTone(score: number | undefined) {
  if (score == null) return "text-muted-foreground";
  if (score >= 80) return "text-emerald-600";
  if (score >= 62) return "text-amber-600";
  return "text-destructive";
}

export function IPhoneProCapturePanel({ compact = false, lastQuality, className }: IPhoneProCapturePanelProps) {
  const { settings, updateSettings } = useScannerSettings();
  const profiles = listProCaptureProfiles();
  const activeProfile = getProCaptureProfile(settings.proCaptureMode);
  const probablyIPhone = isProbablyIPhone();
  const ActiveIcon = modeIcon[activeProfile.mode] || Camera;

  if (compact) {
    return (
      <div className={cn("rounded-xl border bg-card p-3", className)}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ActiveIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">iPhone Pro Capture</p>
                <Badge variant={settings.proCaptureEnabled ? "default" : "secondary"}>
                  {settings.proCaptureEnabled ? "armed" : "standard"}
                </Badge>
                {probablyIPhone && <Badge variant="outline">iPhone detected</Badge>}
              </div>
              <p className="truncate text-xs text-muted-foreground">{getCaptureModeBadge(activeProfile.mode)}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={settings.proCaptureMode}
              onValueChange={(value) => updateSettings({ proCaptureMode: value as ProCaptureMode })}
            >
              <SelectTrigger className="h-9 w-[168px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.mode} value={profile.mode}>
                    {profile.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={settings.proPreferredLens}
              onValueChange={(value) => updateSettings({ proPreferredLens: value as typeof settings.proPreferredLens })}
            >
              <SelectTrigger className="h-9 w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {lensOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={settings.proOrientationLock}
              onValueChange={(value) => updateSettings({ proOrientationLock: value as typeof settings.proOrientationLock })}
            >
              <SelectTrigger className="h-9 w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {orientationOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Switch
              checked={settings.proCaptureEnabled}
              onCheckedChange={(checked) => updateSettings({ proCaptureEnabled: checked })}
              aria-label="Enable iPhone Pro capture profile"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className={cn("border-primary/20 bg-gradient-to-br from-card to-primary/5", className)}>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5 text-primary" />
              iPhone 17 Pro Capture Engine
            </CardTitle>
            <CardDescription>
              Hardware-aware scanner profiles for rapid stacks, binder pages, foil glare, macro text, slabs, and verification.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={settings.proCaptureEnabled ? "default" : "secondary"}>
              {settings.proCaptureEnabled ? "Pro profiles enabled" : "Standard capture"}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Cpu className="h-3 w-3" /> Local-first
            </Badge>
            {probablyIPhone && <Badge variant="outline">iPhone detected</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {profiles.map((profile) => {
            const Icon = modeIcon[profile.mode] || Camera;
            const active = profile.mode === settings.proCaptureMode;
            return (
              <button
                key={profile.mode}
                type="button"
                onClick={() => updateSettings({ proCaptureMode: profile.mode })}
                className={cn(
                  "rounded-xl border p-3 text-left transition-all hover:border-primary/60 hover:bg-primary/5",
                  active ? "border-primary bg-primary/10 shadow-sm" : "border-border bg-background/60"
                )}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground")} />
                    <span className="text-sm font-semibold">{profile.shortLabel}</span>
                  </div>
                  {active && <CheckCircle2 className="h-4 w-4 text-primary" />}
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">{profile.description}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge variant="outline" className="text-[10px]">
                    {profile.lens.replace("_", " ")}
                  </Badge>
                  {profile.multiFrame && (
                    <Badge variant="outline" className="text-[10px]">
                      multi-frame
                    </Badge>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-xl border bg-background/70 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Active capture profile</p>
                <p className="text-xs text-muted-foreground">{getCaptureModeBadge(activeProfile.mode)}</p>
              </div>
              <Switch
                checked={settings.proCaptureEnabled}
                onCheckedChange={(checked) => updateSettings({ proCaptureEnabled: checked })}
                aria-label="Enable iPhone Pro capture profile"
              />
            </div>
            <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <div className="rounded-lg bg-muted/50 p-2">
                <span className="font-medium text-foreground">Lens plan:</span> {activeProfile.lens.replace("_", " ")}
              </div>
              <div className="rounded-lg bg-muted/50 p-2">
                <span className="font-medium text-foreground">Queue:</span> {activeProfile.queuePolicy.replace("_", " ")}
              </div>
              <div className="rounded-lg bg-muted/50 p-2">
                <span className="font-medium text-foreground">Frame:</span> {activeProfile.frameGuide}
              </div>
              <div className="rounded-lg bg-muted/50 p-2">
                <span className="font-medium text-foreground">Zoom target:</span> {activeProfile.recommendedZoom}×
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Preferred iPhone lens</Label>
                <Select
                  value={settings.proPreferredLens}
                  onValueChange={(value) => updateSettings({ proPreferredLens: value as typeof settings.proPreferredLens })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {lensOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Viewfinder orientation</Label>
                <Select
                  value={settings.proOrientationLock}
                  onValueChange={(value) => updateSettings({ proOrientationLock: value as typeof settings.proOrientationLock })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {orientationOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-3 space-y-1">
              {activeProfile.captureTips.map((tip) => (
                <div key={tip} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                  <span>{tip}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border bg-background/70 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Quality gate</p>
                <p className="text-xs text-muted-foreground">Warns before queueing blurry, dark, or glare-heavy captures.</p>
              </div>
              <Switch
                checked={settings.proCaptureQualityGate}
                onCheckedChange={(checked) => updateSettings({ proCaptureQualityGate: checked })}
                aria-label="Enable capture quality gate"
              />
            </div>
            <div className="space-y-3">
              <div>
                <div className="mb-2 flex items-center justify-between text-xs">
                  <Label>Minimum confidence</Label>
                  <span className="font-medium">{settings.proCaptureMinConfidence}%</span>
                </div>
                <Slider
                  value={[settings.proCaptureMinConfidence]}
                  min={45}
                  max={90}
                  step={1}
                  onValueChange={([value]) => updateSettings({ proCaptureMinConfidence: value })}
                  disabled={!settings.proCaptureQualityGate}
                />
              </div>

              <div className="rounded-lg bg-muted/50 p-3">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-medium">Last capture quality</span>
                  <span className={cn("font-bold", confidenceTone(lastQuality?.overall))}>
                    {lastQuality ? `${lastQuality.overall}%` : "waiting"}
                  </span>
                </div>
                <Progress value={lastQuality?.overall ?? 0} className="h-2" />
                {lastQuality ? (
                  <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                    <span>Focus {lastQuality.focus}%</span>
                    <span>Exposure {lastQuality.exposure}%</span>
                    <span>Glare {lastQuality.glare}%</span>
                    <span>Detail {lastQuality.detail}%</span>
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">Capture a card to score focus, exposure, glare, and detail.</p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => updateSettings({ proCaptureMode: "rapid", proCaptureEnabled: true })}
          >
            Use for rapid stacks
          </Button>
          <Button
            variant="outline"
            onClick={() => updateSettings({ proCaptureMode: "binder_9", proCaptureEnabled: true })}
          >
            Use for binder pages
          </Button>
          <Button
            variant="outline"
            onClick={() => updateSettings({ proCaptureMode: "foil", proCaptureEnabled: true })}
          >
            Use for foil cards
          </Button>
          <Button
            variant="outline"
            onClick={() => updateSettings({ proCaptureMode: "macro_text", proCaptureEnabled: true })}
          >
            Use for tiny text
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
