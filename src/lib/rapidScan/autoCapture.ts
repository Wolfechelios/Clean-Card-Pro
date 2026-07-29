import {
  analyzeLumaFrame,
  hammingDistance,
  type FrameMetrics,
} from "./frameAnalysis";
import { getCaptureProfile } from "./captureProfiles";
import type { CaptureMode, CaptureProfileId } from "./contracts";

export type AutoCaptureDecision = {
  capture: boolean;
  rearmed: boolean;
  reason:
    | "not_good"
    | "stabilizing"
    | "stable"
    | "same_card"
    | "cooldown";
};

export type AutoCaptureOptions = {
  requiredStableFrames: number;
  minSharpness: number;
  maxGlareRatio: number;
  cooldownMs?: number;
  maxHashDistance?: number;
};

export function getAutoCaptureOptions(
  profileId: CaptureProfileId,
): AutoCaptureOptions {
  const profile = getCaptureProfile(profileId);
  return {
    requiredStableFrames: Math.max(2, profile.burstFrames),
    minSharpness: profile.autoMinSharpness,
    maxGlareRatio: profile.glareScoring
      ? profile.autoMaxGlareRatio
      : 1,
    cooldownMs: profile.autoCooldownMs,
    maxHashDistance: 2,
  };
}

export function createAutoCaptureController(options: AutoCaptureOptions) {
  const requiredStableFrames = Math.max(
    1,
    Math.floor(options.requiredStableFrames),
  );
  const cooldownMs = Math.max(0, options.cooldownMs ?? 0);
  const maxHashDistance = Math.max(0, options.maxHashDistance ?? 2);
  let armed = true;
  let stableFrames = 0;
  let stableHash: bigint | null = null;
  let acceptedHash: bigint | null = null;
  let acceptedAt = Number.NEGATIVE_INFINITY;

  function reset() {
    armed = true;
    stableFrames = 0;
    stableHash = null;
    acceptedHash = null;
    acceptedAt = Number.NEGATIVE_INFINITY;
  }

  function observe(
    frame: FrameMetrics,
    observedAt = Date.now(),
  ): AutoCaptureDecision {
    const isGood =
      frame.sharpness >= options.minSharpness &&
      frame.glareRatio <= options.maxGlareRatio;
    if (!isGood) {
      stableFrames = 0;
      stableHash = null;
      return { capture: false, rearmed: false, reason: "not_good" };
    }

    let rearmed = false;
    if (!armed && acceptedHash !== null) {
      if (
        hammingDistance(frame.perceptualHash, acceptedHash) <=
        maxHashDistance
      ) {
        return { capture: false, rearmed: false, reason: "same_card" };
      }
      if (observedAt - acceptedAt < cooldownMs) {
        return { capture: false, rearmed: false, reason: "cooldown" };
      }
      armed = true;
      stableFrames = 0;
      stableHash = null;
      rearmed = true;
    }

    if (
      stableHash === null ||
      hammingDistance(frame.perceptualHash, stableHash) > maxHashDistance
    ) {
      stableHash = frame.perceptualHash;
      stableFrames = 1;
    } else {
      stableFrames++;
      stableHash = frame.perceptualHash;
    }

    if (stableFrames < requiredStableFrames) {
      return { capture: false, rearmed, reason: "stabilizing" };
    }

    armed = false;
    acceptedHash = frame.perceptualHash;
    acceptedAt = observedAt;
    stableFrames = 0;
    stableHash = null;
    return { capture: true, rearmed, reason: "stable" };
  }

  return { observe, reset };
}

type FrameAnalysisLoopOptions = {
  schedule: (callback: (timestamp: number) => void) => number;
  cancel: (id: number) => void;
  analyze: (timestamp: number) => void;
  minIntervalMs?: number;
};

export function createFrameAnalysisLoop(options: FrameAnalysisLoopOptions) {
  const minIntervalMs = Math.max(0, options.minIntervalMs ?? 0);
  let running = false;
  let pendingId: number | null = null;
  let lastAnalyzedAt: number | null = null;
  let generation = 0;

  const scheduleNext = (activeGeneration: number) => {
    pendingId = options.schedule((timestamp) => {
      pendingId = null;
      if (!running || generation !== activeGeneration) return;
      if (
        lastAnalyzedAt === null ||
        timestamp - lastAnalyzedAt >= minIntervalMs
      ) {
        lastAnalyzedAt = timestamp;
        try {
          options.analyze(timestamp);
        } finally {
          if (running && generation === activeGeneration) {
            scheduleNext(activeGeneration);
          }
        }
        return;
      }
      scheduleNext(activeGeneration);
    });
  };

  return {
    start() {
      if (running) return;
      running = true;
      lastAnalyzedAt = null;
      generation++;
      scheduleNext(generation);
    },
    stop() {
      if (!running && pendingId === null) return;
      running = false;
      generation++;
      if (pendingId !== null) {
        options.cancel(pendingId);
        pendingId = null;
      }
    },
  };
}

type VideoFrameSchedulerSource = {
  requestVideoFrameCallback?: (
    callback: (timestamp: number, metadata?: unknown) => void,
  ) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

type AnimationFrameScheduler = {
  requestAnimationFrame: (callback: (timestamp: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;
};

export function createCameraFrameScheduler(
  video: VideoFrameSchedulerSource,
  fallback: AnimationFrameScheduler,
) {
  if (
    typeof video.requestVideoFrameCallback === "function" &&
    typeof video.cancelVideoFrameCallback === "function"
  ) {
    return {
      schedule: (callback: (timestamp: number) => void) =>
        video.requestVideoFrameCallback!(callback),
      cancel: (id: number) => video.cancelVideoFrameCallback!(id),
      minIntervalMs: 0,
    };
  }

  return {
    schedule: (callback: (timestamp: number) => void) =>
      fallback.requestAnimationFrame(callback),
    cancel: (id: number) => fallback.cancelAnimationFrame(id),
    minIntervalMs: 100,
  };
}

export function analyzeCameraFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  width = 64,
  height = 64,
): FrameMetrics {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Frame analysis canvas unavailable");
  context.drawImage(video, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  const luma = new Uint8Array(width * height);
  for (let pixel = 0; pixel < luma.length; pixel++) {
    const offset = pixel * 4;
    luma[pixel] = Math.round(
      rgba[offset] * 0.299 +
      rgba[offset + 1] * 0.587 +
      rgba[offset + 2] * 0.114,
    );
  }
  return analyzeLumaFrame(luma, width, height);
}

type AutoCaptureCoordinatorConfig = {
  enabled: boolean;
  captureMode: CaptureMode;
  controllerOptions: AutoCaptureOptions;
  schedule: (callback: (timestamp: number) => void) => number;
  cancel: (id: number) => void;
  minIntervalMs: number;
  analyze: () => FrameMetrics;
};

export function createAutoCaptureCoordinator() {
  let captureMode: CaptureMode = "manual";
  let capture = async () => {};
  let captureInFlight = false;
  let loop: ReturnType<typeof createFrameAnalysisLoop> | null = null;

  const stopLoop = () => {
    loop?.stop();
    loop = null;
  };

  const requestCapture = async (source: CaptureMode): Promise<boolean> => {
    if (source === "auto" && captureMode !== "auto") return false;
    if (captureInFlight) return false;
    captureInFlight = true;
    try {
      await capture();
      return true;
    } finally {
      captureInFlight = false;
    }
  };

  return {
    setCapture(nextCapture: () => Promise<void>) {
      capture = nextCapture;
    },
    configure(config: AutoCaptureCoordinatorConfig) {
      stopLoop();
      captureMode = config.captureMode;
      if (!config.enabled || captureMode !== "auto") return;

      const controller = createAutoCaptureController(
        config.controllerOptions,
      );
      loop = createFrameAnalysisLoop({
        schedule: config.schedule,
        cancel: config.cancel,
        minIntervalMs: config.minIntervalMs,
        analyze(timestamp) {
          if (captureMode !== "auto" || captureInFlight) return;
          const decision = controller.observe(config.analyze(), timestamp);
          if (decision.capture) void requestCapture("auto");
        },
      });
      loop.start();
    },
    manualCapture() {
      return requestCapture("manual");
    },
    stop() {
      stopLoop();
      captureMode = "manual";
    },
  };
}
