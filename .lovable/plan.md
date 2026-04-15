

## Plan: Fix Rate-Limited Price Updates

### Root Cause
The `update-prices` edge function processes up to 50 cards in a tight sequential loop with zero delay. After ~20 cards, the Firecrawl scraping API hits its rate limit (~33 second cooldown), causing the remaining cards to fail silently. Your recently scanned MTG cards were in the failed batch.

### Fix

**File: `supabase/functions/update-prices/index.ts`**

1. **Add delay between price fetches** — insert a 2-second pause between each card to stay under Firecrawl's rate limit
2. **Respect `Retry-After`** — when a rate limit error is returned, wait the specified duration then retry that card once instead of skipping it
3. **Reduce batch size** — process 20 cards per invocation instead of 50, since the function has a limited execution window
4. **Add sequential error recovery** — if 3 consecutive rate limit errors occur, stop processing and return partial results with a count of remaining cards

### Technical Details

| Change | Detail |
|--------|--------|
| Add `await sleep(2000)` between each fetch | Prevents Firecrawl rate limit from triggering |
| Catch rate limit responses (status 429 or `RateLimitError`) | Wait `retryAfterMs` (capped at 35s) then retry once |
| Reduce `.limit(50)` to `.limit(20)` | Keeps total execution time under edge function timeout |
| Return `{ updated, skipped, remaining }` in response | So the client knows to trigger another round |

### Files to edit

| File | Changes |
|------|---------|
| `supabase/functions/update-prices/index.ts` | Add sleep between fetches, retry on rate limit, reduce batch to 20 |

### What stays unchanged
- `fetch-card-prices` function — works fine individually
- Client-side price refresh logic
- All other pricing/scanning code

