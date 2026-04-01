

## Plan: Fix Pricing Pipeline and Add PSA10 to Rapid Scan

### Problem Analysis

**Pricing pipeline** — The `fetch-card-prices` edge function already queries eBay sold listings, TCGPlayer, and PriceCharting in parallel. However:
- A blanket 30% markup is applied to ALL source prices (eBay, TCGPlayer, PriceCharting), inflating results
- The eBay "median" is computed from a generic `$XX.XX` regex across all HTML, which picks up non-sale prices (shipping, listing prices, etc.)
- The response includes `medianRaw` and `raw` (highest) fields but the queue processor ignores them — it only takes `raw` or `suggested`
- No clear separation between "median sold" and "highest sold" in the final result

**Rapid scan PSA10** — The `ProcessedCard` type has no PSA10 field. The queue processor's `cachedFetchPrice` returns only the raw price. The `ScannedCard` interface and `ScannedCardList` UI have no PSA10 rendering.

### Changes

**1. Improve pricing accuracy in `fetch-card-prices` edge function**
- Remove the 30% markup from eBay sold prices — eBay sold listings ARE the market, no inflation needed
- Remove the 30% markup from TCGPlayer market/lastSold prices — these are already accurate market values
- Keep PriceCharting values as-is (no markup)
- Fix the eBay price extraction to better target actual sold prices (look for `s-item__price` pattern used by eBay's sold listings page)
- Add explicit `highestSold` field to the response: the max price from extracted sold prices
- Ensure `medianRaw` represents the true median of sold prices across all sources

**2. Return PSA10 price through the queue processor**
- Update `cachedFetchPrice` in `queueProcessor.ts` to return `{ raw, psa10 }` instead of just a number
- Store the PSA10 value alongside the raw value in `ProcessedCard`

**3. Add PSA10 to rapid scan card display**
- Add `psa10Price?: number | null` to `ProcessedCard` type in `queueProcessor.ts`
- Add `psa10Price?: number | null` to `ScannedCard` interface in `ScannedCardList.tsx`
- Update the `RapidScanCamera` sync `useEffect` to pass `psa10Price` from processed card to the card list
- Also pass `psa10Price` through the `recent-scan-added` event sync path
- Update `ScannedCardList` card row rendering to show PSA10 price next to the raw value (e.g., "PSA 10: $XX.XX" in a small badge below the main price)

**4. Update `recentScans` to carry PSA10**
- Add `psa10Price` field to the recent scan data stored in `addRecentScan`
- Read it back in the sync handler

### Files

| File | Action |
|------|--------|
| `supabase/functions/fetch-card-prices/index.ts` | Edit — remove 30% markups, improve eBay sold price extraction, add `highestSold` |
| `src/lib/queueProcessor.ts` | Edit — extract PSA10 from price response, add to ProcessedCard |
| `src/components/scanner/ScannedCardList.tsx` | Edit — add `psa10Price` to interface, render next to value |
| `src/components/scanner/RapidScanCamera.tsx` | Edit — pass `psa10Price` through both sync paths |
| `src/lib/recentScans.ts` | Edit — add `psa10Price` to recent scan data |

### What stays unchanged
All existing scanning, card recognition, library, history, microscope, foil trainer, import anomaly detection, and UI functionality remains intact.

