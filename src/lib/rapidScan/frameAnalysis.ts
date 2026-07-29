export type FrameMetrics = {
  sharpness: number;
  glareRatio: number;
  perceptualHash: bigint;
};

const HASH_SIDE = 8;
const GLARE_LUMA_THRESHOLD = 245;

function blockAverage(
  luma: Uint8Array,
  width: number,
  height: number,
  blockX: number,
  blockY: number,
): number {
  const startX = Math.floor((blockX * width) / HASH_SIDE);
  const endX = Math.max(startX + 1, Math.floor(((blockX + 1) * width) / HASH_SIDE));
  const startY = Math.floor((blockY * height) / HASH_SIDE);
  const endY = Math.max(startY + 1, Math.floor(((blockY + 1) * height) / HASH_SIDE));
  let total = 0;
  let count = 0;

  for (let y = startY; y < Math.min(endY, height); y++) {
    for (let x = startX; x < Math.min(endX, width); x++) {
      total += luma[y * width + x];
      count++;
    }
  }

  return total / count;
}

export function analyzeLumaFrame(
  luma: Uint8Array,
  width: number,
  height: number,
): FrameMetrics {
  let edgeDifference = 0;
  let edgeCount = 0;
  let glarePixels = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const value = luma[index];
      if (value >= GLARE_LUMA_THRESHOLD) glarePixels++;
      if (x + 1 < width) {
        edgeDifference += Math.abs(value - luma[index + 1]);
        edgeCount++;
      }
      if (y + 1 < height) {
        edgeDifference += Math.abs(value - luma[index + width]);
        edgeCount++;
      }
    }
  }

  const hashSamples = Array.from(
    { length: HASH_SIDE * HASH_SIDE },
    (_, index) =>
      blockAverage(
        luma,
        width,
        height,
        index % HASH_SIDE,
        Math.floor(index / HASH_SIDE),
      ),
  );
  const hashAverage =
    hashSamples.reduce((total, value) => total + value, 0) /
    hashSamples.length;
  let perceptualHash = 0n;
  for (let index = 0; index < hashSamples.length; index++) {
    if (hashSamples[index] >= hashAverage) {
      perceptualHash |= 1n << BigInt(index);
    }
  }

  return {
    sharpness: edgeCount ? edgeDifference / edgeCount : 0,
    glareRatio: luma.length ? glarePixels / luma.length : 0,
    perceptualHash,
  };
}

export function hammingDistance(a: bigint, b: bigint): number {
  let value = a ^ b;
  let count = 0;
  while (value) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

export function createPhysicalFrameDebouncer(options: {
  maxHashDistance: number;
  cooldownMs: number;
}) {
  let previous: { hash: bigint; capturedAt: number } | null = null;
  return {
    accept(frame: { hash: bigint; capturedAt: number }, mode: "auto" | "manual"): boolean {
      if (mode === "manual") {
        previous = frame;
        return true;
      }
      const repeated =
        previous &&
        frame.capturedAt - previous.capturedAt < options.cooldownMs &&
        hammingDistance(frame.hash, previous.hash) <= options.maxHashDistance;
      if (!repeated) previous = frame;
      return !repeated;
    },
  };
}
