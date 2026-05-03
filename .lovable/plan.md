## Problem

Looking at recent `fetch-card-prices` logs, almost every call returns `"source":"No data"`:
- Firecrawl is returning **408 timeouts** on PriceCharting and eBay scrapes constantly.
- PriceCharting "direct URL" guesser builds invalid slugs (e.g. `mountain-battle-for-zendikar-267274`, `benthic-explorers-mirage`) → 408 → falls back to search → also 408.
- The pipeline is 100% scraping-based for MTG, Pokémon, and sports. That's slow, brittle, and costs Firecrawl credits even on failure.
- The `price_cache` table exists in the DB but is never read or written by the edge function.
- `search-card-details` (set lookups) only supports YGO + Pokémon. MTG falls through to YGOProDeck and gets nothing.

## Goal

Make pricing and set lookups **API-first, scrape-fallback**: use the free official catalog APIs as the primary source, hit the DB cache before any network call, and only fall back to Firecrawl when APIs return nothing.

## Changes

### 1. `supabase/functions/fetch-card-prices/index.ts` — API-first pricing

Add new fast adapters that run **before** any Firecrawl scrape:

- **Scryfall (MTG)** — `https://api.scryfall.com/cards/named?fuzzy=...` returns `prices.usd`, `prices.usd_foil`, `prices.usd_etched`. Free, no key, ~100ms. Becomes primary raw price for MTG.
- **YGOProDeck (Yu-Gi-Oh!)** — `card_prices[].tcgplayer_price` / `cardmarket_price`. Free, no key. Primary raw for YGO; PriceCharting/eBay become fallback only.
- **Pokémon TCG (`api.pokemontcg.io/v2`)** — `tcgplayer.prices.{normal,holofoil,reverseHolofoil}.market`. Primary raw for Pokémon.

For each game, only fall back to Firecrawl/PriceCharting/eBay when the API returns null OR when we still need PSA9/PSA10 grades (the APIs only give raw).

### 2. Add price cache read/write

- Before any network call, `SELECT` from `price_cache` keyed by `identity_hash` (sha256 of `name|set|number|game|condition`) where `updated_at > now() - 24h`. If hit, return immediately.
- After a successful pricing result, `INSERT` (upsert on `identity_hash`) into `price_cache` so subsequent calls within 24h skip all scraping.

### 3. Firecrawl resilience

- Add 1 retry with 1s backoff on 408/429/5xx (single retry, not infinite loops).
- Drop the `waitFor: 3000` for PriceCharting (the page is server-rendered) — this is a major contributor to the 408s.
- Skip the "guess direct URL" attempt for PriceCharting and go straight to the search endpoint, which is the only one that reliably returns markdown.

### 4. `supabase/functions/search-card-details/index.ts` — add MTG + smarter routing

- Add `searchScryfall(name)` that returns set name, collector number, rarity, set code, image, and `prices.usd`. Already free + fast.
- Route MTG/Magic to Scryfall, YGO to YGOProDeck, Pokémon to PokémonTCG.io.
- For unknown game type, run Scryfall + YGOProDeck + Pokémon in parallel and return the union (capped at 10 results).

### 5. Schema migration: cache de-dup index

Add a unique index on `price_cache.identity_hash` (currently nullable + no unique key) so the upsert in step 2 works:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS price_cache_identity_source_idx
  ON public.price_cache (identity_hash, source);
```

### 6. Client side

No structural changes — `fetchCardPricesShared` and `EbaySoldAdapter` keep their existing shape. The new API-derived prices populate the same `raw`, `psa9`, `psa10`, `tcgPlayerMarket`, etc. fields, so all downstream consumers (BulkPriceRefresh, queueProcessor, RapidScanCamera, PriceConsensusPanel) work unchanged.

## Files touched

- `supabase/functions/fetch-card-prices/index.ts` (rewrite the source-routing block, add Scryfall/YGOProDeck/PokémonTCG fetchers, add cache layer, harden Firecrawl)
- `supabase/functions/search-card-details/index.ts` (add Scryfall, route by game)
- `supabase/migrations/<new>.sql` (unique index on `price_cache`)

## Out of scope

- No client UI changes.
- No changes to graded-card pricing / PSA10 scrape flow (separate function, working).
- No new external API keys required — all three catalog APIs are free + keyless.
