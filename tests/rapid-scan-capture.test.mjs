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
import { prepareCameraCaptureCanvases } from "../src/lib/rapidScan/captureCanvas.ts";
import { listBundledYugiohSets } from "../src/lib/rapidScan/bundledYugiohSets.ts";
import { deriveBundledYugiohSets } from "../scripts/generate-bundled-yugioh-sets.mjs";
import {
  getScannerSettings,
  updateStoredScannerSettings,
} from "../src/hooks/use-scanner-settings.ts";
import {
  filterRapidScanSets,
  getRapidScanSession,
  normalizeRapidScanSession,
  saveRapidScanSession,
  snapshotRapidScanCaptureContext,
} from "../src/lib/rapidScan/session.ts";

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

test("session defaults to Yu-Gi-Oh, manual capture, and standard profile", () => {
  assert.deepEqual(normalizeRapidScanSession({}), {
    id: "active",
    game: "yugioh",
    selectedSetId: null,
    selectedSetName: null,
    profileId: "standard",
    captureMode: "manual",
  });
  assert.equal(
    normalizeRapidScanSession({ profileId: "toString" }).profileId,
    "standard",
  );
});

test("session persistence preserves legacy scanner settings and snapshots changes", () => {
  const storage = new Map([
    [
      "card-scanner-settings",
      JSON.stringify({
        autoConfirmEnabled: false,
        gameTypeFilter: "auto",
        captureMode: "auto",
        selectedSetId: "lob",
        selectedSetName: "Legend of Blue Eyes White Dragon",
        captureProfileId: "sleeved",
      }),
    ],
  ]);
  const restoreStorage = replaceGlobal("localStorage", {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  });

  try {
    assert.deepEqual(getRapidScanSession(), {
      id: "active",
      game: "yugioh",
      selectedSetId: "lob",
      selectedSetName: "Legend of Blue Eyes White Dragon",
      profileId: "sleeved",
      captureMode: "auto",
    });

    const next = {
      id: "active",
      game: "pokemon",
      selectedSetId: "base",
      selectedSetName: "Base Set",
      profileId: "foil",
      captureMode: "manual",
    };
    saveRapidScanSession(next);
    next.selectedSetName = "Changed after save";
    updateStoredScannerSettings({ scanMode: "SCAN_ONLY" });

    assert.deepEqual(getRapidScanSession(), {
      id: "active",
      game: "pokemon",
      selectedSetId: "base",
      selectedSetName: "Base Set",
      profileId: "foil",
      captureMode: "manual",
    });
    assert.equal(
      JSON.parse(storage.get("card-scanner-settings")).autoConfirmEnabled,
      false,
    );
    assert.equal(
      JSON.parse(storage.get("card-scanner-settings")).gameTypeFilter,
      "auto",
    );
    assert.equal(
      JSON.parse(storage.get("card-scanner-settings")).scanMode,
      "SCAN_ONLY",
    );
  } finally {
    restoreStorage();
  }
});

test("legacy scanner settings receive Rapid Scan session defaults", () => {
  const restoreStorage = replaceGlobal("localStorage", {
    getItem: () => JSON.stringify({ autoConfirmEnabled: false }),
  });

  try {
    const settings = getScannerSettings();
    assert.equal(settings.autoConfirmEnabled, false);
    assert.equal(settings.captureMode, "manual");
    assert.equal(settings.selectedSetId, null);
    assert.equal(settings.selectedSetName, null);
    assert.equal(settings.captureProfileId, "standard");
  } finally {
    restoreStorage();
  }
});

test("set catalog keeps the selected game and presents stable names", () => {
  assert.deepEqual(
    filterRapidScanSets(
      [
        { id: "metal", set_name: "Metal Raiders", game: "Yu-Gi-Oh!" },
        { id: "base", set_name: "Base Set", game: "pokemon" },
        { id: "legend", set_name: "Legend of Blue Eyes", game: "yugioh" },
        { id: "missing", set_name: "", game: "yugioh" },
      ],
      "yugioh",
    ),
    [
      { id: "legend", name: "Legend of Blue Eyes" },
      { id: "metal", name: "Metal Raiders" },
    ],
  );
});

test("bundled Yu-Gi-Oh sets are available without authentication or network", () => {
  const restoreFetch = replaceGlobal("fetch", () => {
    throw new Error("network must not be used");
  });

  try {
    const sets = listBundledYugiohSets([
      { id: "LOCAL", name: "Locally Imported Set" },
    ]);
    assert.ok(sets.length > 100);
    assert.deepEqual(
      sets.find((set) => set.id === "LOB::Legend%20of%20Blue%20Eyes%20White%20Dragon"),
      {
        id: "LOB::Legend%20of%20Blue%20Eyes%20White%20Dragon",
        name: "Legend of Blue Eyes White Dragon",
      },
    );
    assert.deepEqual(
      sets.find((set) => set.id === "LOCAL"),
      { id: "LOCAL", name: "Locally Imported Set" },
    );
  } finally {
    restoreFetch();
  }
});

test("bundled set derivation preserves ambiguous prefixes and is reproducible", () => {
  const records = [
    ["DUEA-EN001", "Duelist Alliance"],
    ["DUEA-EN002", "Duelist Alliance Sneak Peek Participation Card"],
    ["DUEA-EN003", "Duelist Alliance: Deluxe Edition"],
    ["GENF-EN001", "Generation Force"],
    ["GENF-EN002", "Generation Force Sneak Peek Participation Card"],
    ["GENF-EN003", "Generation Force: Special Edition"],
    ["INOV-EN001", "Invasion: Vengeance"],
    ["INOV-EN002", "Invasion: Vengeance Sneak Peek Participation Card"],
    ["INOV-EN003", "Invasion: Vengeance: Special Edition"],
    ["SAST-EN001", "Savage Strike"],
    ["SAST-EN002", "Savage Strike Sneak Peek Participation Card"],
    ["SAST-EN003", "Savage Strike Special Edition"],
    ["DUEA-EN004", "  Duelist   Alliance  "],
  ];
  const asIndex = Object.fromEntries(
    records.map(([setCode, setName]) => [setCode, { setCode, setName }]),
  );
  const reversedIndex = Object.fromEntries(
    [...records]
      .reverse()
      .map(([setCode, setName]) => [setCode, { setCode, setName }]),
  );

  const sets = deriveBundledYugiohSets(asIndex);
  assert.deepEqual(sets, deriveBundledYugiohSets(reversedIndex));
  assert.equal(new Set(sets.map((set) => set.id)).size, sets.length);
  for (const prefix of ["DUEA", "GENF", "INOV", "SAST"]) {
    assert.equal(
      sets.filter((set) => set.id.startsWith(`${prefix}::`)).length,
      3,
      `${prefix} must retain all distinct products`,
    );
  }
});

test("camera capture keeps source pixels unrotated and rotates only the preview", () => {
  const makeCanvas = () => {
    const canvas = { width: 0, height: 0, operations: [], drawnSource: null };
    canvas.getContext = () => ({
      save: () => canvas.operations.push(["save"]),
      restore: () => canvas.operations.push(["restore"]),
      translate: (...args) => canvas.operations.push(["translate", ...args]),
      rotate: (...args) => canvas.operations.push(["rotate", ...args]),
      drawImage: (source) => {
        canvas.operations.push(["drawImage"]);
        canvas.drawnSource = source;
      },
    });
    return canvas;
  };
  const video = { videoWidth: 3, videoHeight: 2 };
  const originalCanvas = makeCanvas();
  const previewCanvas = makeCanvas();

  prepareCameraCaptureCanvases(video, originalCanvas, previewCanvas, 90);

  assert.deepEqual([originalCanvas.width, originalCanvas.height], [3, 2]);
  assert.equal(originalCanvas.drawnSource, video);
  assert.equal(
    originalCanvas.operations.some(([operation]) => operation === "rotate"),
    false,
  );
  assert.deepEqual([previewCanvas.width, previewCanvas.height], [2, 3]);
  assert.equal(previewCanvas.drawnSource, originalCanvas);
  assert.equal(
    previewCanvas.operations.some(([operation]) => operation === "rotate"),
    true,
  );
});

test("capture context snapshots every non-zero rotation and session selection", () => {
  for (const wantedRotation of [90, 180, 270]) {
    const session = {
      id: "active",
      game: "yugioh",
      selectedSetId: "LOB",
      selectedSetName: "Legend of Blue Eyes White Dragon",
      profileId: "foil",
      captureMode: "manual",
    };
    let rotation = wantedRotation;
    const snapshot = snapshotRapidScanCaptureContext(session, rotation);

    session.selectedSetName = "Changed after capture";
    rotation = 0;

    assert.equal(snapshot.rotation, wantedRotation);
    assert.equal(
      snapshot.session.selectedSetName,
      "Legend of Blue Eyes White Dragon",
    );
    assert.notEqual(snapshot.rotation, rotation);
  }
});

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

test("image preparation produces rotated derivatives for every non-zero rotation", async () => {
  const sourcePixels = Uint8ClampedArray.from(
    { length: 3 * 2 * 4 },
    (_, index) => [40, 100, 160, 255][index % 4],
  );

  for (const rotation of [90, 180, 270]) {
    const fakes = createCanvasFakes(sourcePixels, 3, 2);
    const restoreBitmap = replaceGlobal(
      "createImageBitmap",
      async () => fakes.bitmap,
    );
    const restoreCanvas = replaceGlobal(
      "OffscreenCanvas",
      fakes.FakeOffscreenCanvas,
    );
    const originalBlob = new Blob([`original-${rotation}`], {
      type: "image/jpeg",
    });

    try {
      const prepared = await prepareCaptureImages(
        originalBlob,
        "standard",
        rotation,
      );
      const expectedSize = rotation === 180 ? [3, 2] : [2, 3];

      assert.equal(prepared.originalBlob, originalBlob);
      assert.notEqual(prepared.libraryBlob, originalBlob);
      assert.notEqual(prepared.ocrBlob, originalBlob);
      assert.deepEqual(
        fakes.canvases.map(({ width, height }) => [width, height]),
        [expectedSize, expectedSize],
      );
      assert.equal(
        fakes.canvases[0].operations.some(
          ([operation]) => operation === "rotate",
        ),
        true,
      );
    } finally {
      restoreCanvas();
      restoreBitmap();
    }
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
