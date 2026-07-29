import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeLumaFrame,
  createPhysicalFrameDebouncer,
  hammingDistance,
} from "../src/lib/rapidScan/frameAnalysis.ts";

test("automatic frames at or below the hash threshold are suppressed", () => {
  const debounce = createPhysicalFrameDebouncer({ maxHashDistance: 2, cooldownMs: 1200 });
  assert.equal(debounce.accept({ hash: 0b1010n, capturedAt: 1000 }, "auto"), true);
  assert.equal(debounce.accept({ hash: 0b1010n, capturedAt: 1100 }, "auto"), false);
  assert.equal(debounce.accept({ hash: 0b1111n, capturedAt: 1200 }, "auto"), false);
  assert.equal(debounce.accept({ hash: 0b0101n, capturedAt: 1300 }, "auto"), true);
  assert.equal(debounce.accept({ hash: 0b0101n, capturedAt: 1400 }, "manual"), true);
});

test("hamming distance counts changed bits", () => {
  assert.equal(hammingDistance(0b1010n, 0b1111n), 2);
});

test("luma analysis derives sharpness, glare, and a stable physical-frame hash", () => {
  const checkerboard = Uint8Array.from(
    { length: 64 },
    (_, index) => ((Math.floor(index / 8) + index % 8) % 2 === 0 ? 255 : 0),
  );

  assert.deepEqual(analyzeLumaFrame(checkerboard, 8, 8), {
    sharpness: 255,
    glareRatio: 0.5,
    perceptualHash: 0xaa55aa55aa55aa55n,
  });
});
