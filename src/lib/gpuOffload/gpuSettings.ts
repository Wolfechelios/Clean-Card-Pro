import { getScannerSettings } from "@/hooks/use-scanner-settings";

// Helper to normalize base URL for the GPU server.
// Examples accepted:
//  - http://192.168.1.5:8000
//  - https://myhost:8443
//  - 192.168.1.5:8000
export function getGpuServerBaseUrl(): string | null {
  const s = getScannerSettings();
  const enabled = (s as any).gpuOffloadEnabled === true;
  const raw = String((s as any).gpuServerBaseUrl ?? "").trim();
  if (!enabled || !raw) return null;

  const withScheme = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `http://${raw}`;
  try {
    const u = new URL(withScheme);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function getGpuServerWsUrl(): string | null {
  const base = getGpuServerBaseUrl();
  if (!base) return null;
  try {
    const u = new URL(base);
    const proto = u.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${u.host}/ws/stream`;
  } catch {
    return null;
  }
}

export function getGpuStreamPrefs(): { maxFps: number; jpegQuality: number; targetWidth: number } {
  const s = getScannerSettings() as any;
  const maxFps = Number(s.gpuStreamMaxFps ?? 12);
  const jpegQuality = Number(s.gpuStreamJpegQuality ?? 0.65);
  const targetWidth = Number(s.gpuStreamTargetWidth ?? 720);

  return {
    maxFps: Number.isFinite(maxFps) ? Math.max(2, Math.min(30, maxFps)) : 12,
    jpegQuality: Number.isFinite(jpegQuality) ? Math.max(0.35, Math.min(0.95, jpegQuality)) : 0.65,
    targetWidth: Number.isFinite(targetWidth) ? Math.max(320, Math.min(1280, targetWidth)) : 720,
  };
}

/** Return optimal stream prefs for a Jetson server (higher FPS/res). */
export function getJetsonStreamPrefs(): { maxFps: number; jpegQuality: number; targetWidth: number } {
  return { maxFps: 24, jpegQuality: 0.75, targetWidth: 1080 };
}

/** Get server type from settings. */
export function getGpuServerType(): string {
  const s = getScannerSettings() as any;
  return String(s.gpuServerType ?? "auto");
}
