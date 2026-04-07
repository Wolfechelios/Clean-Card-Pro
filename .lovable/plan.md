

## Plan: Fix Inflated Pricing + Ensure Update Prices Uses Same Logic

### Problem
Common cards like "Coach Captain Bearman" get priced at ~$20 due to three bugs in `fetch-card-prices`. Since both the scan pipeline AND the "Update Card Prices" button (`update-prices` edge function, `BulkPriceRefresh` component) all call `fetch-card-prices`, fixing this single function fixes all paths.

### Changes — one file only

**File: `supabase/functions/fetch-card-prices/index.ts`**

#### 1. Remove TCGPlayer blind fallback (lines 291-296)
The `allPriceMatches` fallback extracts every `$X.XX` on the page and computes a median from unrelated prices. Delete this fallback — if named patterns (`market price`, `last sold`, `low`, `mid`, `high`) don't match, return `null` instead.

#### 2. Filter eBay noise (lines 112-136)
- Skip lines containing "bid", "watching", "buy it now", "best offer" (active listings, not sold)
- Cap extraction to first 15 price matches to avoid accumulating prices from unrelated cards further down the page
- Add intra-source outlier filter: if the lowest price in a batch is < $2, reject any price > 20× the lowest

#### 3. Cross-source outlier rejection (lines 394-410)
Before computing `rawPrice` median from `rawCandidates`:
- If 2+ sources agree within 3× of each other and one source is > 5× the others, drop the outlier
- This prevents a $20 eBay noise value from inflating a $0.25 card

#### 4. Include card number in PriceCharting slug (line 176)
When `cardNumber` is available, append it to the slug for more precise matching (e.g., `coach-captain-bearman-mp14-en118` instead of just `coach-captain-bearman`).

### Why this covers "Update Card Prices"
- The Settings page "Update Prices" button calls the `update-prices` edge function, which internally calls `fetch-card-prices`
- The `BulkPriceRefresh` component calls `fetch-card-prices` directly
- The scan pipeline's queue processor calls `fetch-card-prices`
- All three paths go through the same function — one fix covers everything

### Files to edit

| File | Changes |
|------|---------|
| `supabase/functions/fetch-card-prices/index.ts` | Remove TCGPlayer blind fallback; add eBay line filtering; add cross-source outlier rejection; improve PriceCharting slug with card number |

