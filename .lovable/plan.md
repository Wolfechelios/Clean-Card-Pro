

## Plan: Include Card Condition in Price Search Queries

### Problem
The pricing engine searches eBay, TCGPlayer, and PriceCharting without including the card's condition (e.g., "Near Mint 1st Edition", "Lightly Played"). This means a search for "Lavalval Ignis HA06-EN051" returns prices across all conditions, pulling in higher-priced 1st Edition or graded listings that inflate the value of a raw common card.

### Changes

**1. Accept `condition` parameter in edge function**

**File: `supabase/functions/fetch-card-prices/index.ts`**
- Add `condition` to the destructured request body
- Append condition to `searchQuery` when present (e.g., `"Lavalval Ignis HA06-EN051 Near Mint"`)
- Pass condition into eBay search URL (`_nkw=...+near+mint`)
- Pass condition into TCGPlayer search query
- Use condition to filter PriceCharting results (match "near mint" / "lightly played" sections)

**2. Pass `condition` from all callers**

| File | Change |
|------|--------|
| `src/lib/fetchCardPrices.ts` | Add `condition` parameter, pass in body |
| `src/lib/queueProcessor.ts` | Pass card's `condition` field to `fetch-card-prices` invocation |
| `src/lib/pricing/adapters.ts` | Pass `card.condition` in both `EbaySoldAdapter` and `TCGPlayerAdapter` bodies |
| `src/components/pricing/BulkPriceRefresh.tsx` | Include `card.condition` in the bulk refresh body |
| `supabase/functions/update-prices/index.ts` | Include `condition` field from the cards query in the internal fetch call |

**3. Smarter eBay condition filtering**

In the eBay scraper, when condition is "Near Mint" or "NM":
- Exclude lines mentioning "PSA", "BGS", "CGC", "graded", "gem mint" (these are graded cards, not raw NM)
- This prevents graded sale prices from inflating raw card values

### Expected result
"Lavalval Ignis HA06-EN051" with condition "Near Mint" will search for `"Lavalval Ignis HA06-EN051 near mint"` on eBay sold, returning $0.25-$1.00 results instead of $5-$20 graded/1st-edition results.

