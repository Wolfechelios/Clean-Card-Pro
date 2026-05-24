export type ProCaptureMode =
  | "single"
  | "rapid"
  | "binder_9"
  | "slab"
  | "foil"
  | "macro_text"
  | "verify";

export type ProCaptureLens = "auto" | "ultra_wide" | "main_48mp" | "telephoto" | "macro";
export type ProOrientationLock = "auto" | "portrait" | "landscape";

export interface ProCaptureProfile {
  mode: ProCaptureMode;
  label: string;
  shortLabel: string;
  lens: ProCaptureLens;
  idealWidth: number;
  idealHeight: number;
  recommendedZoom: number;
  frameGuide: "card" | "binder" | "label" | "text";
  queuePolicy: "instant" | "offline_queue" | "verify_first";
  localFirst: boolean;
  multiFrame: boolean;
  description: string;
  captureTips: string[];
}

export interface CaptureConfidenceBreakdown {
  overall: number;
  focus: number;
  exposure: number;
  glare: number;
  framing: number;
  detail: number;
  flags: string[];
}

export const PRO_CAPTURE_MODE_STORAGE_KEY = "clean-card-pro-capture-mode-v1";

export const PRO_CAPTURE_PROFILES: Record<ProCaptureMode, ProCaptureProfile> = {
  single: {
    mode: "single",
    label: "Single Card Pro",
    shortLabel: "Single",
    lens: "main_48mp",
    idealWidth: 3840,
    idealHeight: 2880,
    recommendedZoom: 1,
    frameGuide: "card",
    queuePolicy: "verify_first",
    localFirst: true,
    multiFrame: false,
    description: "High-detail capture for one raw card with local confidence scoring before lookup.",
    captureTips: ["Fill the guide with one card", "Tap the card name area to focus", "Keep sleeves flat to reduce glare"],
  },
  rapid: {
    mode: "rapid",
    label: "Rapid Stack",
    shortLabel: "Rapid",
    lens: "main_48mp",
    idealWidth: 2560,
    idealHeight: 1920,
    recommendedZoom: 1,
    frameGuide: "card",
    queuePolicy: "offline_queue",
    localFirst: true,
    multiFrame: false,
    description: "Fast queue-first capture for running through a stack without waiting on pricing APIs.",
    captureTips: ["Shoot first, price after stop", "Use auto-timer for stacks", "Keep the same distance for every card"],
  },
  binder_9: {
    mode: "binder_9",
    label: "Binder 9-Pocket",
    shortLabel: "Binder",
    lens: "ultra_wide",
    idealWidth: 3840,
    idealHeight: 2880,
    recommendedZoom: 0.5,
    frameGuide: "binder",
    queuePolicy: "offline_queue",
    localFirst: true,
    multiFrame: true,
    description: "Whole-page capture profile designed for 9-pocket binder pages and pocket crop workflows.",
    captureTips: ["Square the binder page inside the grid", "Avoid curved pages", "Rescan pockets flagged for glare"],
  },
  slab: {
    mode: "slab",
    label: "Slab / Graded",
    shortLabel: "Slab",
    lens: "telephoto",
    idealWidth: 3840,
    idealHeight: 2880,
    recommendedZoom: 2,
    frameGuide: "label",
    queuePolicy: "verify_first",
    localFirst: true,
    multiFrame: true,
    description: "Telephoto-biased capture for grade labels, certification numbers, and slab reflections.",
    captureTips: ["Put the grade label in the top third", "Tilt slightly if the slab reflects", "Capture label and full card"],
  },
  foil: {
    mode: "foil",
    label: "Foil / Holo Pass",
    shortLabel: "Foil",
    lens: "main_48mp",
    idealWidth: 3840,
    idealHeight: 2880,
    recommendedZoom: 1,
    frameGuide: "card",
    queuePolicy: "verify_first",
    localFirst: true,
    multiFrame: true,
    description: "Multi-frame glare-aware mode for holo, refractor, foil, and glossy cards.",
    captureTips: ["Use lower light if the surface blooms", "Slightly rotate the card", "Let the app flag glare before lookup"],
  },
  macro_text: {
    mode: "macro_text",
    label: "Macro Text Lock",
    shortLabel: "Macro",
    lens: "macro",
    idealWidth: 3840,
    idealHeight: 2880,
    recommendedZoom: 2.5,
    frameGuide: "text",
    queuePolicy: "verify_first",
    localFirst: true,
    multiFrame: false,
    description: "Close-up profile for collector number, set symbol, copyright line, and tiny foil stamps.",
    captureTips: ["Aim at the bottom text line", "Hold still for focus", "Use this after a low-confidence ID"],
  },
  verify: {
    mode: "verify",
    label: "Verify / Price Check",
    shortLabel: "Verify",
    lens: "main_48mp",
    idealWidth: 3840,
    idealHeight: 2880,
    recommendedZoom: 1.5,
    frameGuide: "card",
    queuePolicy: "verify_first",
    localFirst: true,
    multiFrame: true,
    description: "Second-pass capture for set, number, variant, duplicate, and price confidence.",
    captureTips: ["Capture card art and number together", "Use after every valuable hit", "Compare set and number before saving"],
  },
};

export function getProCaptureProfile(mode: ProCaptureMode | undefined | null): ProCaptureProfile {
  return PRO_CAPTURE_PROFILES[mode || "rapid"] ?? PRO_CAPTURE_PROFILES.rapid;
}

export function listProCaptureProfiles(): ProCaptureProfile[] {
  return [
    PRO_CAPTURE_PROFILES.rapid,
    PRO_CAPTURE_PROFILES.single,
    PRO_CAPTURE_PROFILES.binder_9,
    PRO_CAPTURE_PROFILES.foil,
    PRO_CAPTURE_PROFILES.macro_text,
    PRO_CAPTURE_PROFILES.slab,
    PRO_CAPTURE_PROFILES.verify,
  ];
}

export function isProbablyIPhone(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPhone/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

export function getOrientationAspectRatio(mode: ProCaptureMode, orientationLock: ProOrientationLock = "auto"): number {
  const profile = getProCaptureProfile(mode);
  if (orientationLock === "portrait") return 3 / 4;
  if (orientationLock === "landscape") return 4 / 3;
  return profile.frameGuide === "binder" ? 4 / 3 : 3 / 4;
}

export function getOrientationDimensions(
  mode: ProCaptureMode,
  orientationLock: ProOrientationLock = "auto"
): { idealWidth: number; idealHeight: number } {
  const profile = getProCaptureProfile(mode);
  const portrait = orientationLock === "portrait" || (orientationLock === "auto" && profile.frameGuide !== "binder");
  const longSide = Math.max(profile.idealWidth, profile.idealHeight);
  const shortSide = Math.min(profile.idealWidth, profile.idealHeight);
  return portrait ? { idealWidth: shortSide, idealHeight: longSide } : { idealWidth: longSide, idealHeight: shortSide };
}

export function getProVideoConstraints(
  mode: ProCaptureMode,
  selectedDeviceId?: string,
  orientationLock: ProOrientationLock = "auto"
): MediaStreamConstraints {
  const profile = getProCaptureProfile(mode);
  const dims = getOrientationDimensions(mode, orientationLock);
  const base: MediaTrackConstraints = selectedDeviceId
    ? { deviceId: { exact: selectedDeviceId } }
    : { facingMode: { ideal: "environment" } };

  return {
    video: {
      ...base,
      width: { ideal: dims.idealWidth, min: Math.min(1280, dims.idealWidth) },
      height: { ideal: dims.idealHeight, min: Math.min(720, dims.idealHeight) },
      frameRate: { ideal: mode === "rapid" ? 30 : 24, min: 15 },
      aspectRatio: { ideal: getOrientationAspectRatio(mode, orientationLock) },
      resizeMode: { ideal: "none" } as any,
      advanced: [
        { focusMode: mode === "macro_text" ? "manual" : "continuous" } as any,
        { exposureMode: "continuous" } as any,
        { whiteBalanceMode: "continuous" } as any,
      ],
    },
    audio: false,
  };
}

export function getCaptureModeBadge(mode: ProCaptureMode): string {
  const profile = getProCaptureProfile(mode);
  const lens = profile.lens.replace("_", " ");
  return `${profile.shortLabel} • ${lens} • ${profile.idealWidth}×${profile.idealHeight}`;
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function scoreDistance(value: number, target: number, tolerance: number): number {
  return clamp(100 - (Math.abs(value - target) / tolerance) * 100);
}

export function analyzeCanvasCaptureQuality(
  canvas: HTMLCanvasElement,
  mode: ProCaptureMode = "rapid"
): CaptureConfidenceBreakdown {
  const profile = getProCaptureProfile(mode);
  const sampleW = 160;
  const sampleH = 120;
  const sample = document.createElement("canvas");
  sample.width = sampleW;
  sample.height = sampleH;
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  if (!ctx || canvas.width === 0 || canvas.height === 0) {
    return {
      overall: 0,
      focus: 0,
      exposure: 0,
      glare: 0,
      framing: 0,
      detail: 0,
      flags: ["quality_analysis_unavailable"],
    };
  }

  ctx.drawImage(canvas, 0, 0, sampleW, sampleH);
  const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
  const luminance = new Float32Array(sampleW * sampleH);

  let sum = 0;
  let highlights = 0;
  let shadows = 0;
  let saturated = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    luminance[p] = y;
    sum += y;
    if (y > 235) highlights += 1;
    if (y < 18) shadows += 1;
    if (r > 248 && g > 248 && b > 248) saturated += 1;
  }

  const pixelCount = sampleW * sampleH;
  const mean = sum / pixelCount;
  const highlightRatio = highlights / pixelCount;
  const shadowRatio = shadows / pixelCount;
  const saturatedRatio = saturated / pixelCount;

  let edgeEnergy = 0;
  let edgeSamples = 0;
  for (let y = 1; y < sampleH - 1; y += 1) {
    for (let x = 1; x < sampleW - 1; x += 1) {
      const idx = y * sampleW + x;
      const dx = Math.abs(luminance[idx + 1] - luminance[idx - 1]);
      const dy = Math.abs(luminance[idx + sampleW] - luminance[idx - sampleW]);
      edgeEnergy += dx + dy;
      edgeSamples += 1;
    }
  }

  const focusSignal = edgeEnergy / Math.max(edgeSamples, 1);
  const focus = clamp((focusSignal / 26) * 100);
  const exposure = clamp(scoreDistance(mean, 128, 88) - shadowRatio * 80);
  const glare = clamp(100 - highlightRatio * 380 - saturatedRatio * 700);
  const detail = clamp((Math.min(canvas.width, canvas.height) / (profile.frameGuide === "binder" ? 1800 : 1200)) * 100);

  const expectedAspect = profile.frameGuide === "binder" ? 4 / 3 : 3 / 4;
  const actualAspect = canvas.width / canvas.height;
  const framing = clamp(100 - Math.abs(actualAspect - expectedAspect) * 55);

  const flags: string[] = [];
  if (focus < 55) flags.push("soft_focus");
  if (exposure < 55) flags.push(mean < 95 ? "underexposed" : "overexposed");
  if (glare < 65) flags.push("glare_detected");
  if (detail < 70) flags.push("low_resolution");
  if (profile.multiFrame) flags.push("multi_frame_recommended");
  if (mode === "macro_text" && focus < 75) flags.push("macro_refocus_needed");

  const overall = clamp(
    focus * 0.28 +
      exposure * 0.22 +
      glare * 0.22 +
      framing * 0.1 +
      detail * 0.18
  );

  return { overall, focus, exposure, glare, framing, detail, flags };
}

export async function analyzeBlobCaptureQuality(
  blob: Blob,
  mode: ProCaptureMode = "rapid"
): Promise<CaptureConfidenceBreakdown> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas not available");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return analyzeCanvasCaptureQuality(canvas, mode);
}

export function formatQualityFlags(flags: string[]): string {
  if (!flags.length) return "clean_capture";
  return flags.join(", ");
}
