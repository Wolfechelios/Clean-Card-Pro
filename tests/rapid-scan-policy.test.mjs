import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  fuseConfidence,
  normalizeConfidence,
  selectPrintedIdentifier,
} from "../src/lib/rapidScan/scanPolicy.ts";
import {
  buildVideoConstraints,
  filterCameraDevices,
  shouldRetryDefaultCamera,
} from "../src/lib/camera/cameraPolicy.ts";
import {
  countReaderCaptureStates,
  isRetryableScanStatus,
  mergeRecentScanRows,
  reconcileScanRows,
} from "../src/lib/rapidScan/scanRows.ts";

test("normalizes confidence from either 0-1 or 0-100 scales", () => {
  assert.equal(normalizeConfidence(0.92), 0.92);
  assert.equal(normalizeConfidence(92), 0.92);
  assert.equal(normalizeConfidence(-5), 0);
  assert.equal(normalizeConfidence(120), 1);
});

test("fuses normalized OCR and lookup confidence without exceeding one", () => {
  assert.equal(fuseConfidence(91, { success: true, cardData: { confidence: 0.94 } }), 0.98);
  assert.equal(fuseConfidence(0.8, { success: true, cardData: { confidence: 80 } }), 0.8);
  assert.equal(fuseConfidence(70, { success: false }), 0.7);
});

test("repeated printed identifiers remain independently eligible for queue identification", async () => {
  const scans = [
    { setCode: "SDY-046", cardNumber: "046", fullCode: "SDY-046" },
    { setCode: "SDY-046", cardNumber: "046", fullCode: "SDY-046" },
  ];
  assert.deepEqual(
    scans.map((scan) =>
      selectPrintedIdentifier(scan.setCode, scan.fullCode, scan.cardNumber),
    ),
    ["SDY-046", "SDY-046"],
  );

  const queueSource = await readFile(
    new URL("../src/lib/queueProcessor.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(queueSource, /createSessionDuplicateTracker|sessionDuplicates/);
  assert.doesNotMatch(queueSource, /duplicateReservation|\.reserve\(ocr\)/);
  assert.doesNotMatch(queueSource, /type ProcessOutcome = [^;]*"duplicate"/);
  assert.doesNotMatch(queueSource, /reason: "duplicate"|rapid-scan-item-duplicate/);
});

test("filters Camo while retaining native iPhone Continuity Camera", () => {
  const devices = [
    { kind: "videoinput", deviceId: "camo", label: "Camo Camera" },
    { kind: "videoinput", deviceId: "iphone", label: "Wolfe's iPhone Camera" },
    { kind: "videoinput", deviceId: "built-in", label: "FaceTime HD Camera" },
    { kind: "audioinput", deviceId: "mic", label: "Mic" },
  ];

  assert.deepEqual(
    filterCameraDevices(devices).map((device) => device.deviceId),
    ["iphone", "built-in"],
  );
});

test("builds exact selected-device constraints and retries stale IDs only", () => {
  assert.deepEqual(buildVideoConstraints("iphone"), {
    deviceId: { exact: "iphone" },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  });
  assert.equal(shouldRetryDefaultCamera({ name: "OverconstrainedError" }, true), true);
  assert.equal(shouldRetryDefaultCamera({ name: "NotFoundError" }, true), true);
  assert.equal(shouldRetryDefaultCamera({ name: "NotAllowedError" }, true), false);
  assert.equal(shouldRetryDefaultCamera({ name: "OverconstrainedError" }, false), false);
});

test("reconciles processing and error queue metadata into visible rows", () => {
  const rows = [{ id: "scan-1", imageUrl: "blob:1", status: "queued" }];
  const processing = reconcileScanRows(rows, [{ id: "scan-1", status: "processing" }]);
  assert.equal(processing[0].status, "processing");

  const failed = reconcileScanRows(processing, [
    { id: "scan-1", status: "error", error: "No printed code" },
  ]);
  assert.equal(failed[0].status, "error");
  assert.equal(failed[0].error, "No printed code");

  const retried = reconcileScanRows(failed, [{ id: "scan-1", status: "queued" }]);
  assert.equal(retried[0].status, "queued");
  assert.equal(retried[0].error, undefined);
});

test("keeps every durable capture state visible to the reader", () => {
  const durableStates = [
    "captured",
    "processing_ocr",
    "identified",
    "saved",
    "needs_review",
    "identification_error",
  ];

  for (const status of durableStates) {
    const [row] = reconcileScanRows(
      [{ id: status, imageUrl: `blob:${status}`, status: "queued" }],
      [{ id: status, status: "queued", captureStatus: status }],
    );
    assert.equal(row.status, status);
  }
});

test("retry and session counts use durable review and error states", () => {
  assert.equal(isRetryableScanStatus("needs_review"), true);
  assert.equal(isRetryableScanStatus("identification_error"), true);
  assert.equal(isRetryableScanStatus("error"), true);
  assert.equal(isRetryableScanStatus("saved"), false);
  assert.equal(isRetryableScanStatus("processing_ocr"), false);

  const counts = countReaderCaptureStates([
    { id: "1", status: "queued", captureStatus: "captured" },
    { id: "2", status: "processing", captureStatus: "processing_ocr" },
    { id: "3", status: "processing", captureStatus: "identified" },
    { id: "4", status: "success", captureStatus: "saved" },
    { id: "5", status: "error", captureStatus: "needs_review" },
    { id: "6", status: "error", captureStatus: "identification_error" },
  ]);
  assert.deepEqual(counts, {
    captured: 1,
    processing_ocr: 1,
    identified: 1,
    saved: 1,
    needs_review: 1,
    identification_error: 1,
  });
});

test("merges a completed result without dropping other queued scan rows", () => {
  const current = [
    { id: "scan-2", imageUrl: "blob:2", status: "processing" },
    { id: "scan-1", imageUrl: "blob:1", status: "queued" },
  ];
  const recent = [
    {
      id: "scan-2",
      imageUrl: "data:image/jpeg;base64,done",
      status: "completed",
      cardName: "Dark Magician",
    },
  ];

  const merged = mergeRecentScanRows(current, recent);
  assert.deepEqual(merged.map((row) => row.id), ["scan-2", "scan-1"]);
  assert.equal(merged[0].status, "completed");
  assert.equal(merged[1].status, "queued");
});
