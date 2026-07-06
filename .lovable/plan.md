## Goal

Bring back the previous rapid-scan behavior where 200+ cards flowed through the queue smoothly, and fix the current "stuck in processing" symptom when scanning more than one card.

## What's wrong today

- `src/lib/queueProcessor.ts` runs a **single** worker (one `workerActive` flag). Previously the scanner ran **3 concurrent workers** — that's why it could chew through 200 cards.
- When PaddleOCR init fails (see console: `no available backend found … initWasm() failed`), the single worker gets tied up on that item for the full 18s timeout, so every subsequent scan visibly "sits in processing".
- The 5-consecutive-error auto-pause I added last turn now actively hurts recovery: one flaky OCR init pauses the whole queue and the user has to manually resume.
- Failed items were being deleted, which is fine, but stuck "processing" items still show as "processing" in the UI for 5s before the stuck-detector re-picks them — with only 1 worker that reads as "frozen".

## Plan

### 1. Restore concurrent workers in `src/lib/queueProcessor.ts`
- Replace the single `workerActive` boolean with a counter and spawn up to `WORKER_CONCURRENCY = 3` parallel `workerLoop()` instances from `startWorker()`.
- Each loop independently calls `idbGetNextQueued()`; IndexedDB serializes reads, and the item is immediately flipped to `"processing"` so siblings won't grab the same one.
- Reduce `MIN_JOB_DELAY_MS` from 350 → 100 to match the prior throughput.

### 2. Remove the aggressive auto-pause
- Delete `consecutiveErrorCount` / `CONSECUTIVE_ERROR_LIMIT` and the `writeAnomalyPauseFlag(true)` branch in `workerLoop`.
- Keep the per-item delete-on-error (that part is correct — it prevents clogging).
- Rationale: with 3 workers and item deletion, a bad OCR run no longer freezes the pipeline; the queue just moves on.

### 3. Unstick items faster
- In `src/lib/idbQueue.ts`, lower `STUCK_THRESHOLD_MS` in `idbGetNextQueued` / `idbCountQueued` from 5000 → 2000 so orphaned "processing" items reappear quickly.
- On worker startup, run a one-shot sweep that flips any `"processing"` items with `processingStartedAt` older than the threshold back to `"queued"` (defensive — covers a hard reload mid-scan).

### 4. Harden the OCR path so a bad init doesn't hang a worker
- In `src/lib/queueProcessor.ts`, wrap `runLocalCardOcr` in a shorter soft-timeout (e.g., 12s) with a retry-once policy; second failure → delete and move on. The current 18s hard-timeout is what makes "processing" feel stuck.
- No changes to lookup/pricing logic.

### 5. Sanity-check `RapidScanCamera.tsx`
- Confirm `QUEUE_MAX = 500` stays and the capture path still just calls `idbAdd` + `useQueueProcessor.getState().start()`. No UI/behavior change beyond that.

## Files touched

- `src/lib/queueProcessor.ts` — multi-worker, remove auto-pause, tighter OCR timeout.
- `src/lib/idbQueue.ts` — lower stuck threshold, startup requeue sweep helper.
- `src/components/scanner/RapidScanCamera.tsx` — only if the start/enqueue wiring needs a nudge; no visual changes.

## Out of scope

- PaddleOCR wasm loading itself (already patched last turn to the jsdelivr CDN). If it regresses, that's a separate fix.
- Pricing, identification, or UI layout changes.
