import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeLumaFrame,
  createPhysicalFrameDebouncer,
  hammingDistance,
} from "../src/lib/rapidScan/frameAnalysis.ts";
import {
  CAPTURE_PROFILES,
  getCaptureProfile,
} from "../src/lib/rapidScan/captureProfiles.ts";
import { buildProfileConstraints } from "../src/lib/camera/cameraPolicy.ts";
import { prepareCaptureImages } from "../src/lib/rapidScan/imagePipeline.ts";

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };
}

function createCanvasFakes(sourcePixels, sourceWidth, sourceHeight) {
  const canvases = [];
  let bitmapClosed = false;

  class FakeCanvasContext {
    constructor(canvas) {
      this.canvas = canvas;
      this.imageSmoothingEnabled = false;
      this.imageSmoothingQuality = "low";
    }

    save() {
      this.canvas.operations.push(["save"]);
    }

    restore() {
      this.canvas.operations.push(["restore"]);
    }

    translate(x, y) {
      this.canvas.operations.push(["translate", x, y]);
    }

    rotate(radians) {
      this.canvas.operations.push(["rotate", radians]);
    }

    drawImage(source) {
      this.canvas.operations.push(["drawImage"]);
      this.canvas.pixels = new Uint8ClampedArray(source.pixels);
    }

    getImageData() {
      return {
        data: new Uint8ClampedArray(this.canvas.pixels),
        width: this.canvas.width,
        height: this.canvas.height,
      };
    }

    putImageData(imageData) {
      this.canvas.pixels = new Uint8ClampedArray(imageData.data);
    }
  }

  class FakeOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.pixels = new Uint8ClampedArray(width * height * 4);
      this.operations = [];
      canvases.push(this);
    }

    getContext() {
      return new FakeCanvasContext(this);
    }

    async convertToBlob({ type }) {
      return new Blob([this.pixels], { type });
    }
  }

  class FakeHtmlCanvas {
    constructor() {
      this.width = 0;
      this.height = 0;
      this.pixels = new Uint8ClampedArray();
      this.operations = [];
      canvases.push(this);
    }

    getContext() {
      if (this.pixels.length !== this.width * this.height * 4) {
        this.pixels = new Uint8ClampedArray(this.width * this.height * 4);
      }
      return new FakeCanvasContext(this);
    }

    toBlob(callback, type) {
      callback(new Blob([this.pixels], { type }));
    }
  }

  const bitmap = {
    width: sourceWidth,
    height: sourceHeight,
    pixels: sourcePixels,
    close() {
      bitmapClosed = true;
    },
  };

  return {
    bitmap,
    canvases,
    FakeHtmlCanvas,
    FakeOffscreenCanvas,
    get bitmapClosed() {
      return bitmapClosed;
    },
  };
}

test("Prizm and Absolute profiles reduce highlights and require glare scoring", () => {
  const prizm = getCaptureProfile("chrome-prizm");
  const absolute = getCaptureProfile("absolute-high-gloss");
  assert.equal(prizm.glareScoring, true);
  assert.equal(absolute.glareScoring, true);
  assert.ok(prizm.exposureCompensation < 0);
  assert.ok(absolute.highlightCompression > 0);
});

test("capture profiles cannot be changed at runtime", () => {
  assert.equal(Object.isFrozen(CAPTURE_PROFILES), true);
  assert.equal(Object.isFrozen(getCaptureProfile("standard")), true);
  assert.throws(() => {
    getCaptureProfile("standard").contrast = 99;
  }, TypeError);
});

test("profile constraints omit exposure compensation when unsupported", () => {
  const profile = getCaptureProfile("chrome-prizm");
  assert.deepEqual(buildProfileConstraints(profile, {}), {});
});

test("profile constraints clamp exposure compensation to the supported range", () => {
  const profile = getCaptureProfile("chrome-prizm");
  assert.deepEqual(
    buildProfileConstraints(profile, {
      exposureCompensation: { min: -0.4, max: 0.5, step: 0.1 },
    }),
    { advanced: [{ exposureCompensation: -0.4 }] },
  );
});

test("image preparation preserves the original and transforms only the OCR image", async () => {
  const sourcePixels = Uint8ClampedArray.from(
    { length: 3 * 2 * 4 },
    (_, index) => [255, 250, 240, 255][index % 4],
  );
  const fakes = createCanvasFakes(sourcePixels, 3, 2);
  const restoreBitmap = replaceGlobal("createImageBitmap", async () => fakes.bitmap);
  const restoreCanvas = replaceGlobal("OffscreenCanvas", fakes.FakeOffscreenCanvas);
  const originalBlob = new Blob(["original"], { type: "image/jpeg" });

  try {
    const prepared = await prepareCaptureImages(
      originalBlob,
      "absolute-high-gloss",
      90,
    );
    const libraryPixels = new Uint8Array(await prepared.libraryBlob.arrayBuffer());
    const ocrPixels = new Uint8Array(await prepared.ocrBlob.arrayBuffer());

    assert.equal(prepared.originalBlob, originalBlob);
    assert.deepEqual([...libraryPixels.slice(0, 4)], [255, 250, 240, 255]);
    assert.equal(ocrPixels[0], ocrPixels[1]);
    assert.equal(ocrPixels[1], ocrPixels[2]);
    assert.ok(ocrPixels[0] < 250);
    assert.deepEqual(prepared.metrics, {
      sharpness: 0,
      glareRatio: 1,
      perceptualHash: 0xffffffffffffffffn,
    });
    assert.deepEqual(
      fakes.canvases.map(({ width, height }) => [width, height]),
      [
        [2, 3],
        [2, 3],
      ],
    );
    assert.equal(fakes.bitmapClosed, true);
  } finally {
    restoreCanvas();
    restoreBitmap();
  }
});

test("image preparation falls back to normal canvas and always revokes its object URL", async () => {
  const sourcePixels = Uint8ClampedArray.from(
    { length: 2 * 2 * 4 },
    (_, index) => [20, 80, 140, 255][index % 4],
  );
  const fakes = createCanvasFakes(sourcePixels, 2, 2);
  const revoked = [];

  class FakeImage {
    constructor() {
      this.width = 2;
      this.height = 2;
      this.pixels = sourcePixels;
    }

    set src(_value) {
      queueMicrotask(() => this.onload());
    }
  }

  const restoreBitmap = replaceGlobal("createImageBitmap", undefined);
  const restoreOffscreen = replaceGlobal("OffscreenCanvas", undefined);
  const restoreImage = replaceGlobal("Image", FakeImage);
  const restoreDocument = replaceGlobal("document", {
    createElement: () => new fakes.FakeHtmlCanvas(),
  });
  const restoreUrl = replaceGlobal("URL", {
    createObjectURL: () => "blob:rapid-scan-test",
    revokeObjectURL: (url) => revoked.push(url),
  });

  try {
    const prepared = await prepareCaptureImages(
      new Blob(["original"], { type: "image/jpeg" }),
      "standard",
      0,
    );

    assert.equal(prepared.libraryBlob.type, "image/jpeg");
    assert.equal(prepared.ocrBlob.type, "image/jpeg");
    assert.deepEqual(revoked, ["blob:rapid-scan-test"]);
    assert.equal(fakes.canvases.length, 2);
  } finally {
    restoreUrl();
    restoreDocument();
    restoreImage();
    restoreOffscreen();
    restoreBitmap();
  }
});

test("normal image decoding revokes its object URL when loading fails", async () => {
  const revoked = [];

  class FailingImage {
    set src(_value) {
      queueMicrotask(() => this.onerror());
    }
  }

  const restoreBitmap = replaceGlobal("createImageBitmap", undefined);
  const restoreImage = replaceGlobal("Image", FailingImage);
  const restoreUrl = replaceGlobal("URL", {
    createObjectURL: () => "blob:failed-rapid-scan-test",
    revokeObjectURL: (url) => revoked.push(url),
  });

  try {
    await assert.rejects(
      prepareCaptureImages(
        new Blob(["invalid"], { type: "image/jpeg" }),
        "standard",
        0,
      ),
      /Image decoding failed/,
    );
    assert.deepEqual(revoked, ["blob:failed-rapid-scan-test"]);
  } finally {
    restoreUrl();
    restoreImage();
    restoreBitmap();
  }
});

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
