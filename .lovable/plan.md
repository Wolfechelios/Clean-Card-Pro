

## Why your 130-card queue is crawling

Three multipliers stack up to make this roughly 10x slower than it should be:

### 1. Hard-forced 800ms delay between every job
`queueProcessor.ts` line 92:
```
const MIN_SERIAL_JOB_DELAY_MS = 800;
```
And line 154:
```
function getJobDelayMs(): number { 
  return Math.max(getDeviceTier().jobDelayMs, MIN_SERIAL_JOB_DELAY_MS); 
}
```
This **overrides** the device tier's `jobDelayMs` (which is 5–50ms depending on tier) and forces an 800ms pause after every single job. Across 130 cards that's **~104 seconds of pure idle time** even if every job were instant.

### 2. Worker pool starts at 1 and scales up slowly
- `startWorkers()` always starts with **1 worker** (line 396).
- The scaling check runs every **500ms** (`WORKER_SCALE_INTERVAL_MS`) and only adds **one worker per check**.
- Even on a high-tier device (`maxWorkers: 6`), it takes ~3 seconds just to spin up to full capacity. On the "balanced_default" profile it caps at **2 workers**, on "redmagic_standalone" at **3**.

### 3. Per-job processing time is naturally heavy
Each job runs sequentially:
- `hybridIdentifyCard` (timeout 8s) → cloud edge function call
- Optionally `zai-ocr` (timeout 5s) → second edge function on low confidence
- Sometimes a **retry identify** with OCR text (8.5s timeout)
- `fetch-card-prices` (timeout 6s, ≤1 retry) → scrapes PriceCharting + eBay + TCGPlayer
- Storage upload + ownership query

Realistic per-card latency: **4–10 seconds**. With 1–2 workers running serially and 800ms forced delay, 130 cards = **~20–35 minutes**.

### Math estimate

| Setting | Current | After fix |
|---|---|---|
| Forced job delay | 800ms × 130 = 104s | ~10ms × 130 = 1.3s |
| Initial worker count | 1 (scales slowly) | 3–4 immediately |
| Effective parallelism | ~1.5 workers avg | 3–4 workers steady |
| Estimated total for 130 cards | **20–35 min** | **5–8 min** |

---

## Proposed fix

### File: `src/lib/queueProcessor.ts`

**Change 1 — Drop the forced 800ms floor (line 92):**
```ts
const MIN_SERIAL_JOB_DELAY_MS = 50;  // was 800
```
Honor the device tier's `jobDelayMs` (5–50ms). The 800ms floor was likely a leftover safety throttle from earlier rate-limit issues, but `cachedFetchPrice` already has a 10-min in-memory cache and `rateLimitUntil` handles 429s globally.

**Change 2 — Start with full worker count immediately (line 394–398):**
```ts
function startWorkers() {
  if (workersActive <= 0) {
    const initialWorkers = Math.min(getMaxWorkerCount(), 4);
    for (let i = 0; i < initialWorkers; i++) {
      workersActive++;
      workerLoop(i);
    }
  }
  // ... scaling interval still handles upscale beyond 4 if tier allows
}
```
Spawn up to 4 workers on start instead of 1. Scaling interval still kicks in for tiers that allow more.

**Change 3 — Tighten scale check interval (line 90):**
```ts
const WORKER_SCALE_INTERVAL_MS = 250;  // was 500
```
Faster ramp-up when more queue work appears.

### Optional: surface progress better (UI only)
The `QueueStatusIndicator` already shows count/processed/errors, but with 130+ items users have no ETA. **Out of scope** unless you want it added — suggest as a follow-up.

---

## Files changed

| File | Lines | Change |
|---|---|---|
| `src/lib/queueProcessor.ts` | 90, 92, 394–398 | Lower job-delay floor, parallel worker startup, faster scale interval |

## Out of scope

- Edge function latency itself (would require server-side caching of identification results, separate effort)
- Switching to a database-backed queue with background worker (the existing in-browser IDB queue is correct for this app's architecture)
- Phase 1 strict-ordering repair (your previously paused task)

## Verification after deploy

- Open `/scan` with 100+ items queued → console should immediately show `[QueueProcessor] Scaling up: starting worker 1/2/3` within the first second.
- Job delay between completions should drop from ~800ms+ to under 100ms.
- 130 cards should clear in roughly **5–8 minutes** instead of 20–35.

