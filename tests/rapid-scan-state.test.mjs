import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canTransitionCaptureJob } from "../src/lib/rapidScan/contracts.ts";

test("capture state machine permits forward and recovery transitions only", () => {
  assert.equal(canTransitionCaptureJob("captured", "processing_ocr"), true);
  assert.equal(canTransitionCaptureJob("processing_ocr", "identified"), true);
  assert.equal(canTransitionCaptureJob("identified", "saved"), true);
  assert.equal(canTransitionCaptureJob("processing_ocr", "needs_review"), true);
  assert.equal(canTransitionCaptureJob("identification_error", "captured"), true);
  assert.equal(canTransitionCaptureJob("saved", "processing_ocr"), false);
});

test("Dexie schema contains durable capture, inventory, scan event, and idempotency indexes", async () => {
  const source = await readFile(new URL("../src/lib/rapidScan/db.ts", import.meta.url), "utf8");
  assert.match(source, /clean_card_local_v2/);
  assert.match(source, /captureJobs:\s*"id, &idempotencyKey, status, createdAt, \[status\+createdAt\]"/);
  assert.match(source, /inventoryCards:\s*"id, &fingerprint, updated_at"/);
  assert.match(source, /scanEvents:\s*"id, &idempotencyKey, captureJobId, inventoryId, createdAt"/);
  assert.match(source, /migrationReceipts:\s*"id, source, sourceId, \[source\+sourceId\]"/);
  assert.match(source, /transaction\("rw"/);
});
