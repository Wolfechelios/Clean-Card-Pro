

## Plan: Remove Binder Scan + Speed Up App Reactivity

### 1. Remove Binder Scan Feature

Delete or disconnect all binder-related code:

**Delete files:**
- `src/pages/BindersPage.tsx`
- `src/components/binder/BinderScan.tsx`
- `src/components/binder/BinderEditor.tsx`
- `src/components/binder/SlotCard.tsx`
- `src/components/binder/SlotGrid.tsx`
- `src/components/binder/SlotProgress.tsx`
- `src/lib/binder/preprocess.ts`

**Edit files:**
- `src/App.tsx` — remove `BindersPage` lazy import and `/binders` route
- `src/lib/scanAnomalyDetector.ts` — remove `binderScanDetector` export
- `src/components/ui/loading-skeletons.tsx` — remove `BinderSkeleton` export

### 2. Speed Up Queue Processing

Currently the queue enforces a 2-second minimum delay between jobs (`MIN_SERIAL_JOB_DELAY_MS = 2000`). This was added to prevent the "same card name" bug, but with OCR integration and anomaly detection now in place, we can safely reduce it.

**`src/lib/queueProcessor.ts`:**
- Reduce `MIN_SERIAL_JOB_DELAY_MS` from `2000` → `800`
- Reduce `QUEUE_REFRESH_INTERVAL_MS` from `2000` → `1000`
- Reduce edge function timeout from `8000` → `6000` for `rapid-card-identify` and `fetch-card-prices`
- Reduce storage upload timeout from `15000` → `10000`
- Parallelize price fetch and library ownership check (currently sequential — run both with `Promise.all`)

### 3. Speed Up React Query + UI Reactivity

**`src/App.tsx`:**
- Reduce `staleTime` from `30_000` → `10_000` for fresher data on navigation
- Add `suspense: false` to prevent unnecessary loading states

**`src/lib/performance/deviceTier.ts`:**
- Reduce HIGH tier `bulkApiDelayMs` from `50` → `20`
- Reduce HIGH tier `jobDelayMs` from `10` → `5`
- Reduce HIGH tier `pollIntervalMs` from `30` → `15`
- Reduce MID tier delays proportionally

### Files Summary

| File | Action |
|------|--------|
| `src/pages/BindersPage.tsx` | Delete |
| `src/components/binder/*` (5 files) | Delete |
| `src/lib/binder/preprocess.ts` | Delete |
| `src/App.tsx` | Remove binder route + reduce staleTime |
| `src/lib/queueProcessor.ts` | Reduce delays, parallelize price+ownership |
| `src/lib/performance/deviceTier.ts` | Reduce tier delays |
| `src/lib/scanAnomalyDetector.ts` | Remove binderScanDetector |
| `src/components/ui/loading-skeletons.tsx` | Remove BinderSkeleton |

