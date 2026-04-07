

## Plan: Prioritize PriceCharting & SportsCardPro + Condition-Based Pricing

### Problem
Currently, the raw price is computed as a median across all sources equally (TCGPlayer, PriceCharting, eBay, SportsCardPro). PriceCharting and SportsCardPro should be the primary/authoritative sources, with eBay and TCGPlayer as secondary confirmation. Additionally, NM/Mint condition cards should map to ~PSA 8 grade pricing when available.

### Changes

**File: `supabase/functions/fetch-card-prices/index.ts`**

#### 1. Prioritize PriceCharting and SportsCardPro as primary sources (lines 429-434)
Replace the equal-weight median logic with a priority system:
- If PriceCharting has a price, use it as the primary raw value
- If SportsCardPro has a price (sports cards), use it as primary
- Only fall back to eBay/TCGPlayer median if primary sources return null
- If both primary and secondary exist, use primary but sanity-check against secondary (reject primary if >5x off from secondary consensus)

#### 2. Map NM/Mint condition to PSA 8 grade pricing (lines 436-446)
- When condition is "Near Mint", "NM", "Mint", or "NM/Mint":
  - Look for PSA 8 prices in PriceCharting markdown (add regex for `psa\s*8|grade\s*8`)
  - If PSA 8 price found, use it as the `suggested` price for NM cards
  - Store a new `psa8` field or map it to the existing `raw` field with a note

#### 3. Update PriceCharting scraper to extract PSA 8 prices (lines 233-245)
- Add `psa8Match` regex: `/(?:psa\s*8|grade\s*8)[^\n$]*\$([0-9,]+(?:\.\d{2})?)/i`
- Add `psa8` to `SourcePrices` interface
- Return PSA 8 price alongside existing tiers

#### 4. Update SportsCardPro scraper similarly (lines 359-361)
- Add PSA 8 regex extraction
- Return PSA 8 price

#### 5. Update raw price determination logic (lines 429-466)
New priority logic:
```text
For TCG cards:
  1. PriceCharting ungraded → primary raw
  2. TCGPlayer market → secondary confirmation
  3. eBay sold → tertiary confirmation

For sports cards:
  1. SportsCardPro ungraded → primary raw
  2. PriceCharting ungraded → secondary
  3. eBay sold → tertiary

For NM/Mint condition:
  suggested_price = psa8 price (if available) ?? raw price
```

#### 6. Add `psa8` field to PricingResult interface and response (lines 3-29, 460-489)
- Add `psa8`, `medianPsa8`, `ebayPsa8` fields
- Populate from extracted data

### Files to edit

| File | Changes |
|------|---------|
| `supabase/functions/fetch-card-prices/index.ts` | Add PSA 8 extraction to PriceCharting + SportsCardPro scrapers; rewrite raw price logic to prioritize PC/SCP; add condition→grade mapping for NM=PSA8; add psa8 fields to response |

### What stays unchanged
- eBay scraper logic (already filtering graded for raw searches)
- TCGPlayer scraper
- All client-side adapters and consensus engine
- Bulk price refresh and update-prices callers
- All UI components

