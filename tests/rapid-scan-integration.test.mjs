import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("queue worker uses atomic claims and preserves failed jobs", async () => {
  const source = await read("src/lib/queueProcessor.ts");
  const queueSource = await read("src/lib/idbQueue.ts");
  assert.match(source, /idbClaimNextQueued/);
  assert.match(source, /idbUpdateMeta\(id,\s*\{\s*status:\s*"error",\s*error\s*\}\)/s);
  assert.doesNotMatch(source, /function markQueueItemError[\s\S]*?return idbDelete\(id\)/);
  assert.match(source, /const LOCAL_OCR_TIMEOUT_MS = 30_000/);
  assert.match(queueSource, /const PROCESSING_STALE_MS = 60_000/);
  assert.equal((queueSource.match(/PROCESSING_STALE_MS/g) || []).length, 4);
});

test("queue worker prepares capture images once and routes each derivative", async () => {
  const source = await read("src/lib/queueProcessor.ts");
  const processStart = source.indexOf("async function processQueueItem");
  const processSource = source.slice(processStart);

  assert.match(source, /import \{ prepareCaptureImages \}/);
  assert.equal(
    (processSource.match(/prepareCaptureImages\(/g) || []).length,
    1,
    "one processing attempt must prepare image derivatives exactly once",
  );
  assert.match(
    processSource,
    /prepareCaptureImages\(\s*item\.blob,\s*item\.session\?\.profileId \?\? "standard",\s*item\.rotation \?\? 0,\s*\)/s,
  );
  assert.match(
    processSource,
    /blobToBase64DataUrl\(\s*preparedImages\.libraryBlob,/s,
  );
  assert.match(processSource, /const imageUrl = base64/);
  assert.match(processSource, /insertCardDual\(\{[\s\S]*?image_url: imageUrl,/);
  assert.match(processSource, /addRecentScan\(\{[\s\S]*?image_url: imageUrl,/);
  assert.match(
    processSource,
    /runLocalCardOcr\(preparedImages\.ocrBlob\)/,
  );
  assert.doesNotMatch(processSource, /runLocalCardOcr\(item\.blob\)/);
  assert.doesNotMatch(
    processSource,
    /blobToBase64DataUrl\(item\.blob,/,
  );
  assert.doesNotMatch(processSource, /item\.blob\s*=/);
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

test("Rapid Scan integrates camera fallback, queue errors, and retry", async () => {
  const source = await read("src/components/scanner/RapidScanCamera.tsx");
  assert.match(source, /getCameraStreamWithFallback/);
  assert.match(source, /reconcileScanRows/);
  assert.match(source, /idbRetry/);
  assert.match(source, /loadedmetadata/);
});
