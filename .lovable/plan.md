

## Plan: Add Price Anomaly Filter to Collections

### What
Add a "Price Anomaly" filter option that lets users find cards where the stored price looks suspicious — either missing, zero, unusually high, or mismatched against basic heuristics. This works entirely client-side using the card data already loaded.

### Anomaly Detection Criteria (client-side, no API calls needed)
A card is flagged as a price anomaly if ANY of:
1. **No price** — `current_price_raw` is null or 0
2. **Suspiciously high** — raw price > $500 and no PSA 10 price exists (likely wrong card match)
3. **PSA10 cheaper than raw** — `psa10_price < current_price_raw` (impossible in reality)
4. **Game type mismatch pricing** — card has a game_type but price seems from wrong category (e.g., raw > $50 for a common rarity)
5. **Stale price** — `last_price_update` is null or older than 30 days

### Changes

**File: `src/components/collections/AdvancedFilters.tsx`**
- Add `priceAnomaly?: boolean` to `FilterConfig` interface
- Add a "Price Anomaly" toggle/checkbox in the filters UI section

**File: `src/pages/CollectionsPage.tsx`**
- Add anomaly detection logic in `applyFilters()` — when `activeFilters.priceAnomaly === true`, filter to only cards matching any anomaly criteria above
- Support `?anomaly=true` URL param for quick access from dashboard

### Files to edit

| File | Changes |
|------|---------|
| `src/components/collections/AdvancedFilters.tsx` | Add `priceAnomaly` to FilterConfig, add toggle UI |
| `src/pages/CollectionsPage.tsx` | Add anomaly filter logic in `applyFilters()`, read URL param |

### What stays unchanged
- Database schema — no new columns
- Pricing engine, consensus system
- All other filters continue working as before

