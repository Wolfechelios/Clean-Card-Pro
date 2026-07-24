import assert from "node:assert/strict";
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

test("capture starts processing immediately after enqueue", async () => {
  const source = await read("src/components/scanner/RapidScanCamera.tsx");
  const enqueueIndex = source.indexOf("await idbAdd({");
  const startIndex = source.indexOf("processor.start()", enqueueIndex);
  assert.ok(enqueueIndex >= 0, "capture must persist the scan");
  assert.ok(startIndex > enqueueIndex, "capture must start the worker after persisting");
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
