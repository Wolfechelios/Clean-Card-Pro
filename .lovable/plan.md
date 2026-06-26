## Goal

Make **all** card identification **printed-code-first** across Yu-Gi-Oh, Pokémon, Magic: The Gathering, and sports cards. Read the printed set/collector code, normalize it, confirm via the game's authoritative database, then price. Image AI is fallback only.

## Universal pipeline

```text
Capture frame
  → Image normalization (crop, deskew, contrast, sharpen, upscale code region)
  → OCR (code ROI + name ROI + full card, in parallel)
  → Regex extract + normalize code (per-game patterns)
  → Local cache lookup
  → Authoritative DB lookup (per game)
  → Price lookup (set code + name first)
  → Save scan result with confidence tier
  → Image AI / Google Lens only if no code resolved
```

## Per-game code formats + authoritative source

```text
Yu-Gi-Oh    LOB-001, SDY-046, MP25-EN318, RA01-EN001     → YGOPRODeck (cardsetsinfo.php)
Pokémon     SV049/SV122, 4/102, SWSH284, PAL 161         → Pokémon TCG API (api.pokemontcg.io)
MTG         set code + collector # (e.g. NEO 234, MH3 12) → Scryfall (api.scryfall.com/cards/:set/:cn)
Sports      year + manufacturer + #                       → SportsCardsPro / PriceCharting direct
```

Regex per game (applied in order; first match wins):

```text
YGO   \b[A-Z]{2,6}-[A-Z]{0,3}\d{3,4}\b
PKM   \b(SV)?\d{1,4}\s*\/\s*(SV)?\d{1,4}\b   |   \b(SWSH|SM|XY|BW)\d{1,3}\b
MTG   set-code (3-5 letters) + " " + 1-4 digit collector number  (validated via Scryfall)
SPRT  year (1965–2030) + #\s*\d+ + manufacturer keyword
```

## Changes

### 1. Image normalization — new `src/lib/ocr/normalizeForOcr.ts`
- Auto-crop to card rectangle (reuse `lib/visionCardRect.ts`).
- Deskew using detected rectangle angle.
- Per-region preprocessing: grayscale → contrast boost → unsharp mask → 2× upscale.
- Emit canvases for: full card, **bottom strip (code ROI)**, **top strip (name ROI)**.
  - YGO/Pokémon: bottom-left ~20% × 8%
  - MTG: bottom-left ~25% × 5%
  - Sports: bottom or back ~entire bottom strip

### 2. Local OCR — rewrite `src/lib/ocr/localCardOcr.ts`
- Run Tesseract three times (full, code ROI, name ROI) in parallel.
- Code ROI: `tessedit_char_whitelist = A-Z0-9-/`, PSM 7 (single line).
- Apply each game's regex; tag the winning game and code.
- Normalize: collapse whitespace, fix common OCR errors **inside the number section only** (O→0, I/l→1, S→5, B→8); leave prefixes intact unless confidence < 0.4.
- Return `{ game, setCode, collectorNumber, title, edition, rarity, rawText, confidence, regionConfidences }`.

### 3. Authoritative lookup — `supabase/functions/rapid-basic-card-lookup/index.ts`
Add resolver dispatch keyed off detected `game`:

```text
lookupYgoBySetCode      → YGOPRODeck
lookupPokemonByNumber   → Pokémon TCG API (set + number)
lookupMtgByCollector    → Scryfall /cards/:set/:cn
lookupSportsByPrintRun  → PriceCharting direct (no external DB)
```

If a resolver returns a card, treat its name/set/rarity as **authoritative** and overwrite OCR guesses. Set confidence floor 0.92.

### 4. Confidence scoring (shared)
- `+70` exact set/collector code resolves in authoritative DB
- `+20` OCR title fuzzy-matches resolved name (≥ 0.7)
- `+10` rarity/edition match
- `+5`  PriceCharting result title contains the code
- `-50` code resolves to nothing in authoritative DB
- Tiers: **HIGH ≥ 90**, **MEDIUM 60–89**, **LOW < 60**. Persist tier with the scan.

### 5. Pricing query order — `buildPriceChartingQueries`
Reorder for every game:
1. `setCode` alone
2. `setCode + cardName`
3. `cardName + setName + rarity/edition`
4. `cardName + setName`
5. `cardName` (last resort)

**Block** pricing entirely when no code resolves AND OCR title confidence < 0.5 — return `requires_user_disambiguation` so the UI can prompt printing selection.

### 6. Local card cache — new table `card_print_cache`
Shared across games to avoid hammering external APIs:

```sql
create table public.card_print_cache (
  game text not null,
  set_code text not null,
  collector_number text,
  card_name text not null,
  set_name text not null,
  rarity text,
  external_id text,
  payload jsonb,
  updated_at timestamptz default now(),
  primary key (game, set_code, coalesce(collector_number,''))
);
grant select on public.card_print_cache to anon, authenticated;
grant all   on public.card_print_cache to service_role;
alter table public.card_print_cache enable row level security;
create policy "public read card cache" on public.card_print_cache for select using (true);
```
Edge function writes via service role after each successful authoritative hit.

### 7. Fallback UX — `src/lib/queueProcessor.ts`
- On `requires_user_disambiguation`, mark item `needs_review` (don't error), surface in Recent Scans with a "Choose printing" action.
- Run Google Lens **only** when no set/collector code was detected at all.

### 8. Capture path — `src/components/scanner/RapidScanCamera.tsx`
- Normalize image before enqueue; store full card + code ROI blobs on the queue item.
- No identification or pricing in the camera component (already enforced).

## Files touched

```text
src/lib/ocr/normalizeForOcr.ts                              (new)
src/lib/ocr/localCardOcr.ts                                 (rewrite, ROI + multi-game regex)
src/lib/ocr/gameCodePatterns.ts                             (new — regex + normalization per game)
src/lib/idbQueue.ts                                         (add optional codeRoiBlob)
src/lib/queueProcessor.ts                                   (disambiguation, no-code guard)
src/lib/rapidBasicLookupClient.ts                           (pass game/edition/rarity hints)
src/components/scanner/RapidScanCamera.tsx                  (normalize before enqueue)
supabase/functions/rapid-basic-card-lookup/index.ts         (game dispatch, cache I/O, tier output)
supabase/migrations/<ts>_card_print_cache.sql               (new shared cache table)
docs/RAPIDSCAN_SEARCH_STRUCTURE.md                          (update diagram for all games)
```

## Out of scope
- No `cards` table schema changes.
- No new client dependencies (reuse tesseract.js + canvas).
- No UI redesign — the existing "Choose printing" path is reused for disambiguation.
