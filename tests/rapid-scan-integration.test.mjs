import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "fake-indexeddb/auto";

import {
  processClaimedCapture,
} from "../src/lib/queueProcessor.ts";
import {
  claimNextCapture,
  enqueueCapture,
  rapidScanDb,
  retryCapture,
  transitionCapture,
} from "../src/lib/rapidScan/db.ts";
import {
  upsertIdentifiedCapture,
} from "../src/lib/rapidScan/inventoryUpsert.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("queue worker claims durable jobs and does not couple save to pricing or base64", async () => {
  const source = await read("src/lib/queueProcessor.ts");
  const queueSource = await read("src/lib/idbQueue.ts");
  assert.match(source, /claimNextCapture/);
  assert.match(source, /upsertIdentifiedCapture/);
  assert.match(source, /pricingStatus:\s*"pending"/);
  assert.doesNotMatch(source, /blobToBase64DataUrl|FileReader|hasReadablePrice/);
  assert.match(queueSource, /const PROCESSING_STALE_MS = 60_000/);
  assert.equal((queueSource.match(/PROCESSING_STALE_MS/g) || []).length, 4);
});

test("queue worker prepares once, routes derivatives, and publishes only after save", async () => {
  const originalBlob = new Blob(["original"], { type: "image/jpeg" });
  const libraryBlob = new Blob(["library"], { type: "image/jpeg" });
  const ocrBlob = new Blob(["ocr"], { type: "image/jpeg" });
  const events = [];
  const job = captureJob({ originalBlob, rotation: 90 });
  const identified = identifiedResult();

  const outcome = await processClaimedCapture(job, {
    prepareCaptureImages: async (original, profile, rotation) => {
      assert.equal(original, originalBlob);
      assert.equal(profile, "chrome-prizm");
      assert.equal(rotation, 90);
      events.push("prepare");
      return { libraryBlob, ocrBlob };
    },
    runLocalCardOcr: async (image) => {
      assert.equal(image, ocrBlob);
      events.push("ocr");
      return ocrResult();
    },
    resolverFor: (game) => {
      assert.equal(game, "yugioh");
      return {
        game,
        listSets: async () => [],
        resolve: async ({ session, ocr }) => {
          assert.equal(session, job.session);
          assert.equal(ocr.rawText, "Dark Magician\nSDY-046");
          events.push("resolve");
          return identified;
        },
      };
    },
    transitionCapture: async (_id, status) => {
      events.push(`transition:${status}`);
      return { ...job, status };
    },
    upsertIdentifiedCapture: async (savedJob, result, images) => {
      assert.equal(savedJob, job);
      assert.equal(result, identified);
      assert.equal(images.libraryBlob, libraryBlob);
      events.push("save");
      return { inventoryId: "inventory-1", quantity: 1, action: "created" };
    },
    publishSavedScan: (saved) => {
      assert.equal(saved.identity.cardName, "Dark Magician");
      assert.equal(saved.libraryBlob, libraryBlob);
      assert.equal(saved.pricingStatus, "pending");
      events.push("publish");
    },
  });

  assert.equal(outcome, "processed");
  assert.deepEqual(events, [
    "prepare",
    "ocr",
    "resolve",
    "save",
    "publish",
  ]);
});

test("queue worker exposes resolver failures without saving or publishing", async () => {
  const job = captureJob();
  const events = [];

  const outcome = await processClaimedCapture(job, {
    prepareCaptureImages: async () => ({
      libraryBlob: new Blob(["library"]),
      ocrBlob: new Blob(["ocr"]),
    }),
    runLocalCardOcr: async () => ocrResult(),
    resolverFor: () => ({
      game: "yugioh",
      listSets: async () => [],
      resolve: async () => ({
        status: "needs_review",
        candidates: [],
        reason: "Two exact candidates",
      }),
    }),
    transitionCapture: async (_id, status, patch) => {
      events.push({ status, error: patch?.error });
      return { ...job, status };
    },
    upsertIdentifiedCapture: async () => {
      assert.fail("failed identities must not be saved");
    },
    publishSavedScan: () => {
      assert.fail("failed identities must not be published");
    },
  });

  assert.equal(outcome, "error");
  assert.deepEqual(events, [
    { status: "needs_review", error: "Two exact candidates" },
  ]);
});

test("reprocessing one capture idempotency key never increments inventory twice", async () => {
  await rapidScanDb.delete();
  await rapidScanDb.open();
  const job = captureJob({ id: "retry-job", idempotencyKey: "retry-key" });
  await enqueueCapture(job);
  const publishEvents = [];
  const dependencies = {
    prepareCaptureImages: async () => ({
      libraryBlob: new Blob(["library"]),
      ocrBlob: new Blob(["ocr"]),
    }),
    runLocalCardOcr: async () => ocrResult(),
    resolverFor: () => ({
      game: "yugioh",
      listSets: async () => [],
      resolve: async () => identifiedResult(),
    }),
    transitionCapture: async (_id, status) => ({ ...job, status }),
    upsertIdentifiedCapture,
    publishSavedScan: (event) => publishEvents.push(event),
  };

  await processClaimedCapture(job, dependencies);
  await processClaimedCapture(job, dependencies);

  const inventory = await rapidScanDb.inventoryCards.toArray();
  const scanEvents = await rapidScanDb.scanEvents.toArray();
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].quantity, 1);
  assert.equal(scanEvents.length, 1);
  assert.equal(publishEvents.at(-1).quantity, 1);
});

test("interruption after resolution leaves a lease-reclaimable job and saves once", async () => {
  await rapidScanDb.delete();
  await rapidScanDb.open();
  const job = captureJob({ id: "interrupted-job", idempotencyKey: "interrupted-key", status: "captured" });
  await enqueueCapture(job);
  const firstClaim = await claimNextCapture();
  assert.equal(firstClaim.status, "processing_ocr");

  await assert.rejects(
    processClaimedCapture(firstClaim, processingDependencies({
      transitionCapture,
      upsertIdentifiedCapture: async () => {
        throw new Error("simulated tab termination before transaction");
      },
    })),
    /simulated tab termination/,
  );
  assert.equal(
    (await rapidScanDb.captureJobs.get(job.id)).status,
    "processing_ocr",
    "a pre-save interruption must remain lease reclaimable",
  );

  const reclaimed = await claimNextCapture(-1);
  assert.equal(reclaimed.id, job.id);
  await processClaimedCapture(
    reclaimed,
    processingDependencies({ upsertIdentifiedCapture }),
  );

  assert.equal((await rapidScanDb.captureJobs.get(job.id)).status, "saved");
  assert.equal((await rapidScanDb.inventoryCards.toArray())[0].quantity, 1);
  assert.equal(await rapidScanDb.scanEvents.count(), 1);
});

test("identification_error retries through real durable claim and saves once", async () => {
  await rapidScanDb.delete();
  await rapidScanDb.open();
  const job = captureJob({ id: "failure-job", idempotencyKey: "failure-key", status: "captured" });
  await enqueueCapture(job);
  const failedClaim = await claimNextCapture();

  const failed = await processClaimedCapture(
    failedClaim,
    processingDependencies({
      resolverFor: () => ({
        game: "yugioh",
        listSets: async () => [],
        resolve: async () => ({
          status: "identification_error",
          reason: "Unreadable printed code",
        }),
      }),
      transitionCapture,
    }),
  );
  assert.equal(failed, "error");
  assert.equal(
    (await rapidScanDb.captureJobs.get(job.id)).status,
    "identification_error",
  );

  await retryCapture(job.id);
  const retryClaim = await claimNextCapture();
  assert.equal(retryClaim.retryCount, 1);
  assert.equal(retryClaim.status, "processing_ocr");
  await processClaimedCapture(
    retryClaim,
    processingDependencies({ transitionCapture, upsertIdentifiedCapture }),
  );

  assert.equal((await rapidScanDb.captureJobs.get(job.id)).status, "saved");
  assert.equal((await rapidScanDb.inventoryCards.toArray())[0].quantity, 1);
  assert.equal(await rapidScanDb.scanEvents.count(), 1);
});

test("both durable failure states retry back to captured", async () => {
  await rapidScanDb.delete();
  await rapidScanDb.open();
  for (const status of ["needs_review", "identification_error"]) {
    const job = captureJob({
      id: `retry-${status}`,
      idempotencyKey: `retry-${status}`,
      status,
    });
    await rapidScanDb.captureJobs.add(job);
    const retried = await retryCapture(job.id);
    assert.equal(retried.status, "captured");
    assert.equal(retried.retryCount, 1);
  }
});

test("capture starts processing immediately after enqueue", async () => {
  const source = await read("src/components/scanner/RapidScanCamera.tsx");
  const enqueueIndex = source.indexOf("await idbAdd({");
  const startIndex = source.indexOf("processor.start()", enqueueIndex);
  assert.ok(enqueueIndex >= 0, "capture must persist the scan");
  assert.ok(startIndex > enqueueIndex, "capture must start the worker after persisting");
});

test("Rapid Scan set choices use the bundled local catalog without Supabase", async () => {
  const source = await read("src/components/scanner/RapidScanCamera.tsx");
  assert.match(source, /listBundledYugiohSets/);
  assert.doesNotMatch(source, /useAuth|supabase|pc_sets/);
});

test("bundled Yu-Gi-Oh catalog is reproducible from the checked-in local index", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/generate-bundled-yugioh-sets.mjs", "--check"],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("camera snapshots rotation before async capture work and persists it", async () => {
  const source = await read("src/components/scanner/RapidScanCamera.tsx");
  const captureIndex = source.indexOf("async function capture()");
  const snapshotIndex = source.indexOf(
    "snapshotRapidScanCaptureContext(",
    captureIndex,
  );
  const firstAwaitIndex = source.indexOf("await idbCountPending()", captureIndex);
  const enqueueIndex = source.indexOf("await idbAdd({", captureIndex);
  const enqueueEnd = source.indexOf("});", enqueueIndex);
  const enqueueSource = source.slice(enqueueIndex, enqueueEnd);

  assert.ok(snapshotIndex > captureIndex);
  assert.ok(snapshotIndex < firstAwaitIndex);
  assert.match(enqueueSource, /rotation:\s*captureSnapshot\.rotation/);
  assert.doesNotMatch(enqueueSource, /rotation:\s*0/);
});

test("camera persists an unrotated original and uses rotation only for preview and job metadata", async () => {
  const source = await read("src/components/scanner/RapidScanCamera.tsx");
  const captureIndex = source.indexOf("async function capture()");
  const clearIndex = source.indexOf(
    "async function clearQueueAndRecent()",
    captureIndex,
  );
  const captureSource = source.slice(captureIndex, clearIndex);

  assert.match(
    captureSource,
    /prepareCameraCaptureCanvases\(\s*video,\s*originalCanvas,\s*previewCanvas,\s*captureSnapshot\.rotation,\s*\)/s,
  );
  assert.match(
    captureSource,
    /originalCanvas\.toBlob\(resolve,\s*"image\/jpeg",\s*0\.95\)/,
  );
  assert.match(
    captureSource,
    /previewCanvas\.toBlob\(resolve,\s*"image\/jpeg",\s*0\.95\)/,
  );
  assert.match(captureSource, /URL\.createObjectURL\(previewBlob\)/);
  assert.match(captureSource, /compressImageForQueue\(originalBlob\)/);
  assert.doesNotMatch(captureSource, /compressImageForQueue\(previewBlob\)/);
});

test("Rapid Scan uses bundled OCR models and WASM instead of a CDN", async () => {
  const source = await read("src/lib/paddleOCR.ts");
  const serviceWorker = await read("public/sw.js");
  assert.match(source, /\/ocr-assets\/ort\//);
  assert.match(source, /\/ocr-assets\/models\//);
  assert.doesNotMatch(source, /cdn\.jsdelivr\.net/);
  assert.match(serviceWorker, /mjs/);
  assert.match(serviceWorker, /txt/);
  assert.match(serviceWorker, /isBinaryModel/);
});

test("Paddle image conversion accepts strings, Blobs, and ImageBitmaps", async () => {
  const { paddleImageToDataURL } = await import("../src/lib/paddleOCR.ts");
  assert.equal(
    typeof paddleImageToDataURL,
    "function",
    "PaddleOCR must expose its browser image conversion boundary",
  );

  const previous = {
    createImageBitmap: globalThis.createImageBitmap,
    document: globalThis.document,
    ImageBitmap: globalThis.ImageBitmap,
  };
  const draws = [];
  let closed = 0;
  class FakeImageBitmap {
    constructor(width = 320, height = 240) {
      this.width = width;
      this.height = height;
    }
    close() {
      closed += 1;
    }
  }
  globalThis.ImageBitmap = FakeImageBitmap;
  globalThis.createImageBitmap = async () => new FakeImageBitmap();
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: (source, x, y) => draws.push({ source, x, y }),
      }),
      toDataURL: () => "data:image/png;base64,canvas",
    }),
  };

  try {
    assert.equal(
      await paddleImageToDataURL("blob:compatible-string"),
      "blob:compatible-string",
    );
    assert.equal(
      await paddleImageToDataURL(new Blob(["rapid-scan"])),
      "data:image/png;base64,canvas",
    );
    const bitmap = new FakeImageBitmap(100, 80);
    assert.equal(
      await paddleImageToDataURL(bitmap),
      "data:image/png;base64,canvas",
    );
    assert.equal(draws.length, 2);
    assert.equal(closed, 1, "only the internally decoded bitmap is closed");
  } finally {
    globalThis.createImageBitmap = previous.createImageBitmap;
    globalThis.document = previous.document;
    globalThis.ImageBitmap = previous.ImageBitmap;
  }
});

test("Paddle closes Blob-created bitmaps on canvas setup and draw failures", async () => {
  const { paddleImageToDataURL } = await import("../src/lib/paddleOCR.ts");
  const previous = {
    createImageBitmap: globalThis.createImageBitmap,
    document: globalThis.document,
    ImageBitmap: globalThis.ImageBitmap,
  };
  let closed = 0;
  class FakeImageBitmap {
    width = 320;
    height = 240;
    close() {
      closed += 1;
    }
  }
  globalThis.ImageBitmap = FakeImageBitmap;
  globalThis.createImageBitmap = async () => new FakeImageBitmap();
  try {
    for (const failure of ["create", "context", "draw"]) {
      globalThis.document = {
        createElement: () => {
          if (failure === "create") throw new Error("canvas create failed");
          return {
            width: 0,
            height: 0,
            getContext: () =>
              failure === "context"
                ? null
                : {
                    drawImage: () => {
                      throw new Error("canvas draw failed");
                    },
                  },
            toDataURL: () => "unreachable",
          };
        },
      };
      await assert.rejects(
        paddleImageToDataURL(new Blob(["rapid-scan"])),
        /canvas (create|context|draw)|Failed to get canvas context/,
      );
    }
    assert.equal(closed, 3);
  } finally {
    globalThis.createImageBitmap = previous.createImageBitmap;
    globalThis.document = previous.document;
    globalThis.ImageBitmap = previous.ImageBitmap;
  }
});

test("Rapid Scan integrates camera fallback, queue errors, and retry", async () => {
  const source = await read("src/components/scanner/RapidScanCamera.tsx");
  assert.match(source, /getCameraStreamWithFallback/);
  assert.match(source, /reconcileScanRows/);
  assert.match(source, /countReaderCaptureStates\(processor\.queueMeta\)/);
  assert.match(source, /isRetryableScanStatus\(row\.status\)/);
  assert.match(source, /idbRetry/);
  assert.match(source, /loadedmetadata/);
});

function captureJob(overrides = {}) {
  const now = 1_700_000_000_000;
  return {
    id: "capture-1",
    idempotencyKey: "capture-key-1",
    createdAt: now,
    updatedAt: now,
    rotation: 0,
    status: "processing_ocr",
    retryCount: 0,
    session: {
      id: "session-1",
      game: "yugioh",
      selectedSetId: "SDY",
      selectedSetName: "Starter Deck: Yugi",
      profileId: "chrome-prizm",
      captureMode: "manual",
    },
    originalBlob: new Blob(["original"], { type: "image/jpeg" }),
    mime: "image/jpeg",
    ...overrides,
  };
}

function ocrResult() {
  return {
    rawText: "Dark Magician\nSDY-046",
    title: "Dark Magician",
    setCode: "SDY-046",
    cardNumber: "046",
    fullCode: "SDY-046",
    game: "yugioh",
    confidence: 0.98,
    source: "local-browser-ocr",
  };
}

function identifiedResult() {
  return {
    status: "identified",
    identity: {
      game: "yugioh",
      cardName: "Dark Magician",
      printedCode: "SDY-046",
      setId: "SDY",
      setName: "Starter Deck: Yugi",
      language: "en",
      edition: null,
      variant: "Ultra Rare",
      confidence: 0.98,
    },
    selectedSetCorrected: false,
    evidence: ["exact-printed-code:SDY-046"],
  };
}

function processingDependencies(overrides = {}) {
  return {
    prepareCaptureImages: async (originalBlob) => ({
      originalBlob,
      libraryBlob: new Blob(["library"]),
      ocrBlob: new Blob(["ocr"]),
      metrics: { sharpness: 1, glare: 0, perceptualHash: 1n },
    }),
    runLocalCardOcr: async () => ocrResult(),
    resolverFor: () => ({
      game: "yugioh",
      listSets: async () => [],
      resolve: async () => identifiedResult(),
    }),
    transitionCapture: async (_id, status) => ({ status }),
    upsertIdentifiedCapture: async () => ({
      inventoryId: "inventory-1",
      quantity: 1,
      action: "created",
    }),
    publishSavedScan: () => {},
    ...overrides,
  };
}
