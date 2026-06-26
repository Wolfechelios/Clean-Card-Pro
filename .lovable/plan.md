## Problem

Rapid Scan currently fails to identify or price most cards because:

1. The cloud OCR (`zai-ocr`) returns raw text only — it never extracts a card **title** or **set name**. So `ocr.title` / `ocr.name` are always `undefined` when the local OCR fails.
2. `rapid-basic-card-lookup` then queries PriceCharting with weak strings (raw OCR text, no structured title/set), which usually returns nothing. When PriceCharting fails, there is no real pricing fallback.
3. Edge logs confirm: `zai-ocr` is invoked, but `rapid-basic-card-lookup` and `fetch-card-prices` are never hit on the same flow, so the worker dies with "No PriceCharting match found".

## Fix Overview

Make the scanner reliably extract **Title + Set Name + Set Code/Number**, then run a layered identify-and-price pipeline with proper fallbacks.

### 1. Stronger OCR field extraction (`supabase/functions/zai-ocr/index.ts`)

- After Z.AI returns raw text, also derive:
  - `title` — best candidate line (filter noise like "HP", "ATK", "Konami", "©", "Trainer", numeric blocks), pick the largest/most prominent text line near the top.
  - `setName` — match against a known set-name dictionary (Pokémon, Yu-Gi-Oh!, MTG, sports) using fuzzy contains.
  - `setCode`, `cardNumber` — keep current regex.
- Return these fields in the JSON response so `queueProcessor` can use them directly.

### 2. Smarter lookup (`supabase/functions/rapid-basic-card-lookup/index.ts`)

- Accept structured `{ title, setName, setCode, cardNumber }` from the client instead of only `ocrText`.
- Build PriceCharting queries in priority order:
  1. `setCode` (exact match for Yu-Gi-Oh! / Pokémon)
  2. `title + setName`
  3. `title + cardNumber`
  4. `title + game-type hint`
- Log every query tried so we can debug from edge logs.

### 3. Pricing fallback chain

When PriceCharting returns no match or no usable price, fall back in this order:
1. **`fetch-card-prices`** edge function (already exists) — call with `{ cardName, cardSet, cardNumber, gameType }`. Returns raw/PSA10 in the unified schema.
2. **`bulk-enrich-tcgplayer`** (TCG cards) or **`bulk-enrich-sports-prices`** (sports) for a single-card price.
3. If all fail, mark the item `priced: false` and surface a "needs review" badge instead of throwing.

### 4. Queue processor wiring (`src/lib/queueProcessor.ts`, `src/lib/rapidBasicLookupClient.ts`)

- Pass structured OCR fields into the lookup call (not just compacted text).
- After lookup, if `pricing` is empty, call the `fetch-card-prices` fallback in-place using the identified `cardName` + `cardSet`.
- Lower the confidence floor from 0.30 to 0.20 — confidence only blocks **auto-save**, never blocks pricing.
- Add visible per-stage logging: `[QueueProcessor] ocr → identify → price` for each item.

### 5. Memory + safety

- Honor existing single-worker / anomaly-pause rules — no change there.
- Respect existing pricing-source priority memory (PSA10 > PSA9 > raw > etc.).
- No schema changes, no new tables.

## Files Changed

```text
supabase/functions/zai-ocr/index.ts             (extract title + setName)
supabase/functions/rapid-basic-card-lookup/index.ts  (structured queries, better logging)
src/lib/rapidBasicLookupClient.ts               (pass structured fields)
src/lib/queueProcessor.ts                       (use fields, add fetch-card-prices fallback, lower floor)
```

## Validation

- Deploy the three edge functions.
- Curl-test `zai-ocr` with a known card image; confirm it returns `title` and `setName`.
- Curl-test `rapid-basic-card-lookup` with `{ title:"Cyber Dragon", setName:"Legendary Collection 5D's", setCode:"LC5D-EN094" }`; confirm a PriceCharting URL and prices.
- In-app: scan one Yu-Gi-Oh, one Pokémon, one sports card. Confirm each shows a name, set, and at least one price in the result panel.
- Watch edge function logs to see the new per-stage messages and confirm `fetch-card-prices` is invoked when PriceCharting misses.

## Out of Scope

- Local browser OCR model upgrades.
- Changing the scanner UI/viewfinder.
- New pricing providers beyond the ones already wired.
