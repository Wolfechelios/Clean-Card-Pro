## What's happening

Two separate problems.

**1. Magic cards can't be identified at all (confirmed).**
The Rapid Scan pipeline is Yu-Gi-Oh only right now:

- `src/lib/ocr/gameCodePatterns.ts` has patterns for Yu-Gi-Oh, Pokémon, and sports — but **no Magic pattern**. An MTG collector line like `0123/281 R  DMU` gets matched by the Pokémon fraction regex, so the card is tagged as `pokemon` and the set code (`DMU`) is thrown away.
- `src/lib/rapidBasicLookupClient.ts` only ever resolves Yu-Gi-Oh (local PriceCharting match, then YGOPRODeck). Everything else falls through to `{ success: false, error: "No Yu-Gi-Oh printed-code lookup match..." }`. Its type even lists a `"scryfall"` source, but nothing calls Scryfall.

So an MTG scan is guaranteed to end as an error item, never a result row.

**2. The page went white.**
The exact crash is **not yet confirmed** — the console snapshot has no stack trace, so step 1 below is to capture it before changing rendering logic. The scanner view is only covered by the single app-wide `ErrorBoundary` in `App.tsx`, so anything that throws during a scan blanks the whole app instead of showing an error inside the scan list.

---

## The plan

### Step 1 — Stop the white screen and capture the cause
- Wrap the Rapid Scan view (`ScanPage` / `RapidScanCamera`) in its own error boundary so a failure shows a "Scanner hit an error — Retry" card inside the page instead of blanking the app.
- Have that boundary log the component stack to the console and to `pipelineTracer`, so the next occurrence names the failing component.
- Harden the two spots in the scan list that assume shape: the `$${row.value.toFixed(2)}` cell and the `<img src={row.imageUrl}>` preview (blob URLs are already failing to load per the network log — fall back to a placeholder instead of a broken image).
- Make error items always surface: today `rapid-scan-item-error` only patches a row that already exists in state (`prev.map`), so an item that errors before/after its row is reconciled shows nothing. Change it to insert an error row if one isn't present.

### Step 2 — Detect the Magic printed code
In `gameCodePatterns.ts`:
- Add an MTG matcher for the modern bottom-left block: collector number (`123/281`, `0123`), rarity letter (`C/U/R/M`), and the 3-letter set code (`DMU`, `MOM`, `LTR`), plus the `™ & © Wizards of the Coast` line as a game hint.
- Run the MTG matcher **before** the Pokémon fraction matcher, and only let the Pokémon fraction win when Pokémon hint words are present — otherwise MTG keeps getting misfiled.
- For older cards with no collector line, fall back to `game: "mtg"` with the card title only (Wizards/Deckmaster copyright text as the signal).

In `ocrQuality.ts`: accept an MTG code (`setCode` + collector number, or a title-only MTG hit) as a valid printed identifier so the pipeline doesn't reject the scan at the gate.

### Step 3 — Look the card up on Scryfall
New `src/lib/mtg/scryfallLookup.ts` (pure client-side fetch, no backend):
- Exact route: `GET /cards/:set/:collector_number` when both set code and number were read.
- Fallback: `GET /cards/named?fuzzy=<title>` when only the title was read.
- Return card name, set name, set code, collector number, rarity, finish, plus `prices.usd` / `prices.usd_foil` as the raw price.
- Cache responses in local storage keyed by `set/number` so re-scans are instant.

Wire it into `runRapidBasicLookup`: route by detected game — `mtg` → Scryfall, `yugioh` → existing path, and make the "no match" error message game-specific instead of always saying "Yu-Gi-Oh".

### Step 4 — Pricing
Use Scryfall's USD price as the raw value (it's included in the same response, so no extra call). Where a graded/PSA 10 value is expected, leave it null for MTG rather than inventing one — the existing pricing panel already handles a null PSA 10.

---

## Technical notes

- Scryfall is a free public API with no key; it asks for a `User-Agent` and ~100ms between requests. The queue runs 3 workers, so add a small shared rate limiter in the Scryfall module.
- No database or backend changes — this stays inside the local-first architecture.
- Files touched: `src/lib/ocr/gameCodePatterns.ts`, `src/lib/ocr/ocrQuality.ts`, `src/lib/rapidBasicLookupClient.ts`, `src/components/scanner/RapidScanCamera.tsx`, `src/pages/ScanPage.tsx`, plus new `src/lib/mtg/scryfallLookup.ts`.
- Pokémon and sports scans keep their current behavior; only the misclassification of MTG-as-Pokémon changes.

## Verification

- Scan an MTG card: expect a completed row with the correct name, set, and USD price.
- Scan an unreadable card: expect a visible error row, not a blank page.
- Re-scan a Yu-Gi-Oh card to confirm no regression.
