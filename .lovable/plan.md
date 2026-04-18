

## Plan: Fix Rapid Scan Failures + MTG Pricing (PriceCharting + eBay Sold ≤2y)

### Root causes

**Why scans keep failing:**

1. **`fetch-card-prices` has eBay and PriceCharting hard-disabled** — both are wired as `Promise.resolve(emptySource())` (lines 496–501). Only COMC and TCGPlayer run. COMC returns 0 results for most MTG cards (logs confirm: `Razorfin Hunter`, `Consume Strength` → "No data"). So every MTG scan returns `raw: null`.
2. **Aggressive timeouts in queue processor** — `IDENTIFY_TIMEOUT_MS = 3500ms`, `OCR_TIMEOUT_MS = 2500ms`. Mobile + cold-start edge functions regularly exceed this, throwing "timed out" → marked as `error`.
3. **Silent discard at confidence < 0.3** — line 667 of `queueProcessor.ts` deletes the IDB item with no user-visible record (`idbDelete(item.id)` then `return`). Looks like a "missing" scan.
4. **Lovable AI 429 fallback** — `rapid-card-identify` only falls back to user Gemini key if `lovableExhausted` flag is set AND user has a valid key. If user has no Gemini key, scans fail outright on rate limits.
5. **`gameType` arrives as `null`** — logs show `gameType: null` for MTG cards. Without a hint, PriceCharting/COMC can't pick the right category. The hybrid identifier sometimes returns no game_type, and the queue processor doesn't backfill from `scanSettings.gameTypeFilter` before pricing.

### Fixes

**1. Re-enable PriceCharting and eBay (MTG-focused)** — `supabase/functions/fetch-card-prices/index.ts`
- Restore real `fetchPriceChartingPrices(...)` and `fetchEbayPrices(...)` calls (replace the `Promise.resolve(emptySource())` stubs).
- Update eBay scrape URL to add `&_sop=13` (sold, ended recently) AND apply a **2-year date filter** by parsing each row's "Sold <date>" string from Firecrawl markdown — drop any sale older than today minus 24 months. Re-compute median only on the kept set.
- Update `pickPrimaryWithSanity` priority for MTG specifically:
  - `gameType` includes `mtg/magic` → **PriceCharting first → eBay sold-median (≤2y) second → TCGPlayer third**. COMC dropped to last resort for MTG.
- Pass `gameType` into both functions (already accepts it).

**2. eBay date-filter helper** — same file
- Add a regex pass on each line: `/Sold\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i` → parse to Date → reject if `< now - 730 days`.
- Lines without a parseable sold-date are kept (Firecrawl sometimes strips them) but logged.

**3. Stop silent scan loss** — `src/lib/queueProcessor.ts`
- Replace the `idbDelete(item.id)` discard at line 669 with `idbUpdateMeta(item.id, { status: "error", error: "Low confidence — needs review" })` so the item stays visible and the user knows.
- Add a console + toast notification on first low-conf discard per session.

**4. Loosen scan timeouts** — `src/lib/queueProcessor.ts`
- `IDENTIFY_TIMEOUT_MS`: 3500 → **8000** (matches edge function realistic latency)
- `OCR_TIMEOUT_MS`: 2500 → **5000**
- Keep `UPLOAD_TIMEOUT_MS` at 8000.

**5. Backfill `gameType` from user setting before pricing** — `src/lib/queueProcessor.ts` (around line 657)
- If `gameType` is null AND `scanSettings.gameTypeFilter !== "auto"`, set `gameType` to the canonical map (e.g. `mtg` → `"MTG"`) before calling `cachedFetchPrice`.

**6. Better Lovable AI → Gemini fallback** — `supabase/functions/rapid-card-identify/index.ts`
- Allow Gemini fallback even when `LOVABLE_API_KEY` is missing the `lovableExhausted` flag (any 5xx, network error, or empty content should also trigger fallback if a Gemini key is available).
- Removes silent failures when Lovable AI hiccups.

### Files changed

| File | Change |
|---|---|
| `supabase/functions/fetch-card-prices/index.ts` | Re-enable PC + eBay; add 2-year sold filter; MTG priority order |
| `src/lib/queueProcessor.ts` | Looser timeouts; preserve low-conf items; backfill gameType |
| `supabase/functions/rapid-card-identify/index.ts` | Broader Gemini fallback conditions |

### Out of scope

- Full Phase 1 strict-ordering repair (separate paused task)
- New IDB schema fields (`captureIndex`, etc.)
- Settings UI for pricing source toggles

### Verification after deploy

- Scan an MTG card → response should include non-null `raw` from PriceCharting OR eBay median.
- Check `fetch-card-prices` logs for `[PriceCharting]` and `[eBay]` lines (they were absent before).
- Low-confidence captures should now show in the queue with an error badge instead of disappearing.

