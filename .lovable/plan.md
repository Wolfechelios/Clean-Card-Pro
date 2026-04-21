

## MTG Edition Finder + Alpha/Beta/Unlimited/Revised Recognizer

Add specialized identification for early MTG core sets (Alpha, Beta, Unlimited, Revised, 4th Edition) which are visually similar but have huge price differences. Includes a manual Edition Finder tool to disambiguate any MTG card across all printings.

### Why this matters

These early sets have **no set symbol** printed on the card (set symbols started with Exodus 1998), so the AI currently can't reliably tell them apart. The price difference is massive:
- Alpha Black Lotus: ~$100,000+
- Beta Black Lotus: ~$30,000
- Unlimited Black Lotus: ~$8,000
- Revised "Black Lotus" doesn't exist (banned)

A misidentification = catastrophic valuation error.

### Visual recognition rules (encoded in AI prompt)

| Set | Year | Corners | Border | Copyright | Card stock |
|---|---|---|---|---|---|
| **Alpha** (LEA) | 1993 | Heavily rounded (large radius) | Black | None / "© 1993" | Lighter back, no beveled edge |
| **Beta** (LEB) | 1993 | Sharp / square corners | Black | "© 1993" | Same back as Alpha |
| **Unlimited** (2ED) | 1993 | Sharp corners | White | "© 1993" | White border = key tell |
| **Revised** (3ED) | 1994 | Sharp corners | White | "© 1994" | Lighter, washed-out art |
| **4th Edition** (4ED) | 1995 | Sharp corners | White | "© 1995" | Brighter print quality |
| **5th Edition** (5ED) | 1997 | Sharp corners | White | "© 1997" | Pre-modern frame |

Set symbol absent + black border + copyright year = **Alpha or Beta** (corner radius decides).
Set symbol absent + white border + copyright year = **Unlimited / Revised / 4ED / 5ED** (year decides).

### What to build

#### 1) Backend: enhance MTG identification prompt
**`supabase/functions/enhanced-card-identify/index.ts`** + **`supabase/functions/rapid-card-identify/index.ts`**

Add a new MTG section to the prompt:
```
STEP 0 — EARLY EDITION DETECTION (cards with NO set symbol):
1. Check border color: BLACK → Alpha or Beta. WHITE → Unlimited/Revised/4ED/5ED.
2. If BLACK border: check corner radius. Heavily rounded = Alpha. Sharp = Beta.
3. If WHITE border: read copyright year exactly.
   - "© 1993" → Unlimited
   - "© 1994" → Revised
   - "© 1995" → 4th Edition
   - "© 1997" → 5th Edition
4. Output card_set as the full set name AND set_code (lea/leb/2ed/3ed/4ed/5ed).
5. Set early_edition_confidence: high/medium/low.
```

Force the model to return a new `early_edition` field for MTG: `{ detected: boolean, set_code: string, confidence: "high"|"medium"|"low", visual_evidence: string }`.

#### 2) Backend: Scryfall Edition Finder edge function
**New: `supabase/functions/mtg-edition-finder/index.ts`**

Input: `{ cardName: string, hintYear?: number, hintSetCode?: string }`
Output: All printings of the card with prices, ordered by release date.

```
GET https://api.scryfall.com/cards/search
  ?q=!"Card Name"
  &unique=prints
  &order=released
```

Returns array of:
```
{
  set_code, set_name, year, collector_number,
  border_color, frame, rarity,
  prices: { usd, usd_foil, usd_etched },
  image_uri,
  is_early_set: bool  // lea/leb/2ed/3ed/4ed/5ed
}
```

This is the data source for the Edition Finder UI.

#### 3) Backend: post-process MTG identification
**`supabase/functions/_shared/officialNameResolver.ts`**

Add `lookupMtgByNameAndEarlyEdition()`: when AI returns `early_edition.detected = true`, query Scryfall directly with the detected set code (`lea`, `leb`, `2ed`, etc.) + card name to confirm and grab official metadata + price.

#### 4) Frontend: Edition Finder UI

**New: `src/components/mtg/MtgEditionFinder.tsx`**

A dialog/panel with:
- Input: card name (autocomplete via Scryfall `/cards/autocomplete`)
- Optional: paste copyright year, border color, corner type
- Result: scrollable list of all printings, each row showing:
  - Set name + year + set code badge
  - Border color swatch + frame era
  - Card image thumbnail
  - Raw price + foil price
  - "Select this printing" button → updates the card record

Highlight early-set rows (LEA/LEB/2ED/3ED/4ED) with a gold "Vintage" badge.

#### 5) Frontend: integrate into Verify dialog
**`src/components/pricing/CardVerificationDialog.tsx`**

When the verified card is MTG, show an "Edition Finder" button that opens `MtgEditionFinder` pre-filled with the card name. User picks correct printing → patch updates set/year/price.

#### 6) Frontend: integrate into Card Detail Modal
**`src/components/cards/CardDetailModal.tsx`**

Add "Find Edition" button next to the set field for any MTG card. Opens `MtgEditionFinder`.

#### 7) Frontend: highlight in Rapid Scan
**`src/components/scanner/CardIdentificationEditor.tsx`**

If identified card is MTG with `early_edition.confidence !== "high"`, show a yellow banner: "Early MTG set suspected — verify edition" with one-tap Edition Finder button.

### Files

| File | Change |
|---|---|
| `supabase/functions/enhanced-card-identify/index.ts` | Add early-edition detection prompt + `early_edition` output field |
| `supabase/functions/rapid-card-identify/index.ts` | Same prompt addition |
| `supabase/functions/mtg-edition-finder/index.ts` (new) | Scryfall printings lookup + price aggregation |
| `supabase/functions/_shared/officialNameResolver.ts` | `lookupMtgByEarlyEdition()` Scryfall confirmation |
| `src/lib/mtg/editionFinder.ts` (new) | Client wrapper for the edge function |
| `src/components/mtg/MtgEditionFinder.tsx` (new) | Printing picker dialog |
| `src/components/pricing/CardVerificationDialog.tsx` | "Edition Finder" button for MTG cards |
| `src/components/cards/CardDetailModal.tsx` | "Find Edition" button next to set field |
| `src/components/scanner/CardIdentificationEditor.tsx` | Low-confidence early-edition warning banner |

No DB schema changes. Uses public Scryfall API (no key needed).

### Memory updates
- Update `mem://logic/mtg-card-identification-rules` with the early-edition visual matrix (Alpha/Beta/Unlimited/Revised/4ED/5ED rules)

### Verification

- Scan an Unlimited card → AI returns `early_edition.set_code = "2ed"`, price matches Unlimited Scryfall data
- Scan a Beta card with rounded corners → flagged "Alpha or Beta — verify"; open Edition Finder, pick LEB
- Open any MTG card in Collections, click "Find Edition" → see all printings with prices, switching updates the record
- Verify dialog on an MTG card shows Edition Finder shortcut

