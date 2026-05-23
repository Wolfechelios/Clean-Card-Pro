

## Plan: Fix Build Errors, COMC Category Bug, and Scan Reliability

### Problem Summary
Three issues are causing scan failures and build problems:

1. **Build errors** — Three files use `Record<string, any>` for Supabase `.update()` calls, which the new strict typing rejects.
2. **COMC wrong category** — Sports cards (Dave Winfield, Eddie Murray, etc.) are searched under "Pokemon" on COMC because the category logic only handles MTG; everything else defaults to "Pokemon". This returns zero results for all sports cards.
3. **Rate limiting delays** — Lovable AI is consistently rate-limited, causing every scan to wait 3+ seconds before falling back to your Gemini key. Not a code bug, but adds latency.

### Changes

**1. Fix build errors (3 files)**

| File | Fix |
|------|-----|
| `src/components/collections/CardsNeedingReview.tsx` (lines 168, 251) | Cast `dbUpdates`/`updates` from `Record<string, any>` to the proper Supabase update type using `as any` on the `.update()` call |
| `src/components/settings/BulkCardReidentify.tsx` (line 148) | Same fix — cast `updateData` with `as any` in the `.update()` call |

**2. Fix COMC category mapping (`supabase/functions/fetch-card-prices/index.ts`)**

The `fetchCOMCPrices` function (line 384) currently defaults to `"Pokemon"` for all non-MTG cards, including sports cards. Fix:

- Add `"Baseball"`, `"Football"`, `"Basketball"`, `"Hockey"` categories based on `gameType` and `sportType` (need to pass `sportType` into the function)
- Add `"Yu-Gi-Oh"` category
- Only default to `"Pokemon"` when the game type is actually Pokemon
- For unknown types, use a generic COMC search without category

**3. Skip Lovable AI retry delay (optional optimization)**

In the `rapid-card-identify` edge function, reduce the rate-limit retry wait from 2 attempts (1s + 2s = 3s) to 1 attempt (1s) before falling back to the user's Gemini key, cutting wasted time in half.

### Technical Details

- The COMC function signature needs `sportType` added as a parameter
- The caller in the main handler (~line 460-470) needs to pass `sportType` through
- COMC category map: `baseball` → `"Baseball"`, `football` → `"Football"`, `basketball` → `"Basketball"`, `hockey` → `"Hockey"`, `yugioh` → `"Yu-Gi-Oh"`, `pokemon` → `"Pokemon"`, `mtg/magic` → `"Magic"`

