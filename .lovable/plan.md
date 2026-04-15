

## Plan: Limit Pricing Sources to COMC + TCGPlayer Only

### Problem
The `fetch-card-prices` edge function scrapes 5 sources in parallel (eBay, PriceCharting, TCGPlayer, SportsCardPro, COMC), consuming Firecrawl credits and adding latency. You only want COMC and TCGPlayer.

### Changes

**File: `supabase/functions/fetch-card-prices/index.ts`**

In the main handler (~lines 488-497):
- Remove `ebayPromise` — replace with `Promise.resolve(emptySource())`
- Remove `pcPromise` — replace with `Promise.resolve(emptySource())`
- Remove `scpPromise` — replace with `Promise.resolve(emptySource())`
- Keep `tcgPromise` and `comcPromise` as-is
- Expand COMC eligibility to all card types (remove the MTG/Pokémon restriction on line 486)

The aggregation logic (lines 506-557) stays intact — it already handles null values from inactive sources gracefully. The priority picker will naturally fall through to COMC/TCGPlayer data.

**File: `src/lib/pricing/adapters.ts`**

In `getDefaultAdapters()` (~line 224):
- Remove `EbaySoldAdapter` and `PriceChartingLocalAdapter` from the default array
- Keep only `TCGPlayerAdapter` (and a COMC adapter if one exists, otherwise the COMC data comes through `fetch-card-prices` already)
- Remove the sports card adapter addition

### Files to edit

| File | Changes |
|------|---------|
| `supabase/functions/fetch-card-prices/index.ts` | Disable eBay, PriceCharting, SportsCardPro scraping; expand COMC to all card types |
| `src/lib/pricing/adapters.ts` | Remove eBay and PriceCharting adapters from defaults |

### What stays unchanged
- COMC and TCGPlayer scraping functions (unchanged)
- Database schema, queue processor, consensus logic
- `sports-card-prices` edge function (separate, untouched)
- All price display components

