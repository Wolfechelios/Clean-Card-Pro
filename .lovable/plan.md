

## Why it's still slow — root causes per card

Each card today goes through this serial chain (mobile, balanced profile):

| Step | Time | Notes |
|---|---|---|
| Identify (cloud LLM) | 3–5s | `rapid-card-identify` → Lovable AI or Gemini |
| **OCR fallback** if conf <0.5 | 2–3s | `zai-ocr` |
| **Identify AGAIN** with OCR text | 3–5s | re-runs full LLM call with OCR hint |
| Pricing — **waits for ALL sources** | 3–5s | `Promise.all([eBay, PriceCharting, TCGPlayer, SCP, COMC])` — slowest scrape gates the result |
| Upload + ownership (parallel) | 1–2s | not the bottleneck |
| **Total per card** | **8–15s** typical, **15–20s on weak scans** | |

The user said: *"a picture just readable enough for OCR to work … use pricecharting.com or tcg.com to get the price, label it, move on."*

The current pipeline is doing 3× the work that's actually needed.

## Fix — strip it back to: identify → race-to-first-price → label → done

### 1. Kill the double-identify on low confidence
**File:** `src/lib/queueProcessor.ts` (lines 549–608)

- Remove the OCR fallback retry that runs `hybridIdentifyCard` a second time.
- If first identify returns `confidence < 0.3` or `Unknown Card` → mark error and move on (already does that at line 690).
- If confidence ≥ 0.3 → trust it and proceed to pricing.

This alone removes 5–8s from every weak scan.

### 2. Race pricing sources instead of awaiting all
**File:** `supabase/functions/fetch-card-prices/index.ts` (lines 519–535)

Replace `Promise.all` with a **race-to-first-non-null** pattern using the game-specific priority order:

- **MTG** → race PriceCharting + TCGPlayer; first one back with a non-null price wins. eBay only runs as a background fallback if both return null. COMC + SCP not called at all.
- **Pokémon / YGO** → race TCGPlayer + PriceCharting; eBay fallback.
- **Sports** → race SportsCardPro + PriceCharting; eBay fallback.

Add a hard **3.5s overall pricing timeout** — if no source returns by then, return `raw: null` and label the card "price pending" so it doesn't block the queue.

### 3. Tighten timeouts to match the simpler pipeline
**File:** `src/lib/queueProcessor.ts`

- `IDENTIFY_TIMEOUT_MS`: 8000 → **5000** (single attempt now, no retry padding needed)
- `OCR_TIMEOUT_MS`: 5000 → **0** (removed)
- Pricing edge call: 6000ms timeout, **0 retries** (was 1 retry — doubling latency on every transient failure)

### 4. Don't compress the photo any harder than needed for OCR
**File:** `src/lib/imageCompressor.ts`

- Drop default `maxWidth` from 1600 → **1200**, `quality` 0.82 → **0.75**.
- Cuts upload time and base64 conversion time roughly in half. User said readable-for-OCR is the only requirement.

### 5. Skip the ownership query when in non-SAVE mode
**File:** `src/lib/queueProcessor.ts` (line 736–761)

The `cards` table count + select runs on every single card even when scan mode is `SCAN_ONLY`. Skip it unless `scanMode === "SAVE"` — saves 200–500ms per card on mobile.

## Expected per-card time after fix

| Step | Time |
|---|---|
| Identify (single call, no retry) | 3–4s |
| Pricing (first source wins, 3.5s cap) | 1.5–3s |
| Upload + maybe ownership (parallel, off critical path) | — |
| **Total per card** | **~4–6s** down from 8–15s |

Combined with the existing 4–6 parallel workers, **130 cards should clear in ~3–5 minutes** instead of 20+.

## Files changed

| File | Change |
|---|---|
| `src/lib/queueProcessor.ts` | Remove OCR-retry loop, tighten timeouts, skip ownership in non-SAVE mode |
| `supabase/functions/fetch-card-prices/index.ts` | Race sources to first non-null, 3.5s cap, drop COMC/SCP for non-target games |
| `src/lib/imageCompressor.ts` | Lower default quality/dims (OCR-grade, not display-grade) |

## Out of scope

- Phase 1 strict-ordering rapid scan repair
- New IDB schema fields
- Settings UI for pricing source toggles

## Verification

- Scan an MTG card → first scan completes in ~4s end-to-end.
- Edge logs show only `[PriceCharting]` and `[TCGPlayer]` for MTG (no eBay unless both return null).
- 50-card queue clears in under 3 minutes.

