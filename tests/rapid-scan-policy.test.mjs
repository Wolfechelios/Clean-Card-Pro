import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionDuplicateTracker,
  fuseConfidence,
  normalizeConfidence,
} from "../src/lib/rapidScan/scanPolicy.ts";
import {
  buildVideoConstraints,
  filterCameraDevices,
  shouldRetryDefaultCamera,
} from "../src/lib/camera/cameraPolicy.ts";
import {
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

test("duplicate tracking rejects only a repeated printed identifier in the same session", () => {
  const tracker = createSessionDuplicateTracker("session-a");
  const scan = { setCode: "SDY-046", cardNumber: "046", fullCode: "SDY-046" };

  const first = tracker.reserve(scan);
  assert.equal(first.duplicate, false);
  assert.equal(typeof first.token, "string");
  assert.equal(tracker.reserve(scan).duplicate, true);

  tracker.release(first.token);
  const retry = tracker.reserve(scan);
  assert.equal(retry.duplicate, false, "a failed scan must be retryable");

  tracker.reset("session-b");
  assert.equal(tracker.reserve(scan).duplicate, false);
  assert.equal(tracker.reserve({ title: "Dark Magician" }).duplicate, false);
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
