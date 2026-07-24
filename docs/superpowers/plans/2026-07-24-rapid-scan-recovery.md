# Rapid Scan Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the live Rapid Scan camera-to-OCR-to-set-code lookup pipeline without removing existing features.

**Architecture:** Keep the current browser-local OCR and printed-code-first lookup design. Repair the queue at its persistence boundary with atomic IndexedDB claims, keep failed jobs visible and retryable, use bundled OCR assets, and isolate browser camera policy into testable helpers.

**Tech Stack:** React 18, TypeScript, Vite, Zustand, IndexedDB, ONNX Runtime Web, PaddleOCR, Node test runner.

## Global Constraints

- Preserve the existing scanner UI, rotation, zoom, focus, Continuity Camera, local library, and pricing behavior.
- Rapid Scan must start processing immediately after capture.
- Yu-Gi-Oh identification remains printed set/card code first.
- Rapid Scan must not require Ollama, Supabase functions, or an external OCR CDN.
- Camo virtual cameras must not appear as scanner choices.

---

### Task 1: Regression tests

**Files:**
- Create: `tests/rapid-scan-policy.test.mjs`
- Create: `tests/rapid-scan-integration.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Node 24 native TypeScript loading and `node:test`.
- Produces: `npm test`, covering confidence normalization, duplicate tracking, camera filtering, row error reconciliation, local OCR asset wiring, and queue integration.

- [x] Write tests that import `scanPolicy.ts`, `cameraPolicy.ts`, and `scanRows.ts`, which do not exist yet.
- [x] Run `node --test tests/*.test.mjs`; expect module-not-found failures.
- [x] Add `"test": "node --test tests/*.test.mjs"` and `"typecheck": "tsc -p tsconfig.app.json --noEmit"` scripts.

### Task 2: Queue repair and error recovery

**Files:**
- Create: `src/lib/rapidScan/scanPolicy.ts`
- Create: `src/lib/rapidScan/scanRows.ts`
- Modify: `src/lib/idbQueue.ts`
- Modify: `src/lib/queueProcessor.ts`
- Modify: `src/components/scanner/RapidScanCamera.tsx`

**Interfaces:**
- Produces: `normalizeConfidence(value)`, `fuseConfidence(ocr, lookup)`, `createSessionDuplicateTracker()`, `reconcileScanRows(rows, queueMeta)`, `idbClaimNextQueued()`, `idbRetry(id)`, and `idbCountPending()`.

- [x] Move confidence fusion and session duplicate tracking into the tested policy module.
- [x] Replace the corrupted queue block with one duplicate check after OCR tracing and one valid `endIdentify()` call.
- [x] Atomically claim queued or stale-processing jobs in one IndexedDB read/write transaction.
- [x] Store failures as `status: "error"` with the error message.
- [x] Reconcile queue metadata into visible scan rows and add a Retry button that returns an error job to queued.
- [x] Keep `processor.start()` immediately after every successful capture enqueue.
- [x] Run `npm test`; expect the queue and row tests to pass.

### Task 3: Bundled OCR assets

**Files:**
- Modify: `src/lib/paddleOCR.ts`

**Interfaces:**
- Consumes: `/ocr-assets/models/*` and `/ocr-assets/ort/*` already committed under `public`.
- Produces: same-origin OCR model and WASM loading.

- [x] Replace jsDelivr model and ONNX Runtime paths with `/ocr-assets/` paths.
- [x] Keep one WASM thread for iPhone/Safari memory stability.
- [x] Run the OCR asset regression test and typecheck.

### Task 4: Safari and Continuity camera recovery

**Files:**
- Create: `src/lib/camera/cameraPolicy.ts`
- Modify: `src/components/scanner/RapidScanCamera.tsx`
- Modify: `src/hooks/use-camera-devices.tsx`

**Interfaces:**
- Produces: `isBlockedCameraLabel(label)`, `filterCameraDevices(devices)`, `buildVideoConstraints(deviceId)`, and `getCameraStreamWithFallback(mediaDevices, deviceId)`.

- [x] Filter Camo labels while preserving native iPhone/Continuity cameras.
- [x] Try the selected device with exact constraints, then retry the default camera on `NotFoundError` or `OverconstrainedError`.
- [x] Wait for `loadedmetadata`, call `play()`, and enforce a five-second startup timeout.
- [x] Clear a stale saved device ID when fallback is used.
- [x] Run camera policy tests.

### Task 5: Verification and online update

**Files:**
- Verify all modified files.

**Interfaces:**
- Produces: a single reviewed commit on `main`.

- [x] Run `npm ci` with a writable temporary npm cache.
- [x] Run `npm test`.
- [x] Run `npm run typecheck`.
- [x] Run `npm run build`.
- [x] Run focused ESLint on modified source files.
- [x] Review `git diff --check`, `git diff --stat`, and the complete diff.
- [x] Commit and push the verified fast-forward update to `origin/main`.
