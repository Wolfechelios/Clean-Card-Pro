# Scan Pipeline Health Monitor

A secondary failsafe that watches every stage of the scan → identify → price → save pipeline, records timing + pass/fail per stage, and surfaces exactly where a card breaks down.

## Goal

Right now when a card "gets stuck" you can't tell whether it's the camera capture, PaddleOCR, card identification, pricing lookup, or the DB save that failed. This adds structured per-stage telemetry plus a live diagnostic panel.

## What gets built

### 1. Pipeline tracer (`src/lib/pipelineTracer.ts`) — new
A lightweight in-memory + IndexedDB event bus that records every stage transition per queue item.

Stages tracked:
```text
capture  → image acquired from camera / upload
enqueue  → item written to idbQueue
ocr      → PaddleOCR / local OCR result
identify → card matched (name/set/number)
price    → pricing adapters returned a value
save     → written to Supabase cards table
```

Each entry: `{ itemId, stage, status: 'start'|'ok'|'fail'|'timeout', ms, error?, meta? }`.
Ring buffer of last 200 items kept in IndexedDB so it survives reloads.

### 2. Instrument existing pipeline
Wrap the existing call sites with `trace.begin(stage)` / `trace.end(stage, result)` — no logic changes:
- `src/lib/queueProcessor.ts` — around OCR, identify, price, save calls in `processQueueItem`
- `src/lib/enhancedCardIdentify.ts` (or `hybridCardIdentify.ts`) — identify stage result
- `src/lib/fetchCardPrices.ts` — price stage result + which adapter answered
- `src/components/scanner/RapidScanCamera.tsx` — capture + enqueue

### 3. Self-test runner (`src/lib/pipelineSelfTest.ts`) — new
On-demand end-to-end check that does NOT touch the user's real queue:
- Runs a canned fixture image through OCR → identify → price (dry-run, no DB write)
- Also does a lightweight Supabase ping (auth session + a `select 1`-style read against `cards`)
- Returns `{ stage, ok, ms, error }[]` so the UI can render a green/red checklist

### 4. Diagnostic UI (`src/components/scanner/PipelineHealthPanel.tsx`) — new
Collapsible panel reachable from the scan page (small "Diagnostics" button near `QueueStatusIndicator`):
- **Live stage feed**: last 20 items × 6 stages as a colored grid (green ok / amber slow / red fail / grey skipped) with hover to see error + ms
- **Aggregate**: success rate per stage over last 50 items — instantly shows "OCR failing 80%" vs "pricing failing 80%"
- **Run self-test** button → renders the checklist from step 3
- **Copy diagnostics** button → dumps last 50 traces as JSON to clipboard for support

### 5. Auto-flag stuck items
When queueProcessor's stuck-detector fires, also emit a `stage: 'stuck'` trace entry so the panel shows *why* a specific card sat in processing.

## Technical notes

- Zero new dependencies; uses existing `idb-keyval`-style helpers already in `src/lib/idbQueue.ts`.
- Tracer is a no-op if disabled via a `localStorage` flag (default: on in dev, on for everyone since footprint is tiny).
- No behavior change to the scan pipeline — pure observation layer. If tracing throws, it's swallowed and never blocks a scan.
- Panel is lazy-loaded so it doesn't add to scan-page bundle.

## Out of scope

- Fixing individual pipeline bugs uncovered by the monitor (separate follow-up per finding).
- Server-side aggregation / uploading traces anywhere.
