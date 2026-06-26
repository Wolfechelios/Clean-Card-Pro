
## Problem

Card names being saved are unrelated to the actual cards. Edge function logs show OCR is returning pure garbage (`". L ¥. a"`, `"o © 0"`, `"SPR os, ARR"`, `"| . B"`) and the pipeline then:

1. Sends that garbage as a PriceCharting search query, which returns a wrong-but-real product (e.g. `"Anaba Bodyguard"`, `"Consume Strength"` — random MTG cards).
2. Or falls back in `queueProcessor.ts` (lines 404–419) to using OCR's `title` directly as the card identity — even when the title is `". L ¥. a"`.

Net effect: every low-quality scan is saved as a confidently-wrong card.

## Root cause

There is no quality gate between OCR output and "this is the card's name." The pipeline trusts:
- any non-empty OCR string as a searchable title
- any PriceCharting hit as ground truth, even when the query is junk
- its own OCR fallback identity when lookup fails

## Fix plan

Add a hard **identity gate** before anything is named, priced, or saved. No valid printed code AND no validated title → the scan goes to "Needs Review", never to the collection with a fabricated name.

### 1. OCR quality validation (`src/lib/ocr/ocrQuality.ts` — new)

Single helper used by the worker:

```ts
isReadableTitle(s)        // ≥3 letters, ≥60% alpha chars, contains a real word (≥4 letters)
isValidPrintedCode(s)     // matches game regex from gameCodePatterns.ts
validateTitleAgainstRaw() // normalized title substring of normalized OCR raw text
```

Reject titles that are mostly punctuation/symbols (current garbage all fails the alpha-ratio test).

### 2. `src/lib/queueProcessor.ts`

- Before calling `runRapidBasicLookup`, compute `hasValidCode` and `hasValidTitle`. If **neither** is true → mark item `needs_review` with reason "Unreadable scan — retake photo" and stop. Do **not** call PriceCharting with garbage.
- Remove the OCR-as-identity fallback (lines 404–419). Replace with: if lookup didn't return `cardData`, mark `needs_review` — never invent an identity from OCR alone.
- Raise the floor: require `lookup.source` to be one of the authoritative sources (`cache`, `ygoprodeck`, `pokemontcg`, `scryfall`, `pricecharting-set-code`) **or** require `validateTitleAgainstRaw(identify.card_name, ocr.rawText)` to pass when source is a fuzzy/Lens match.
- Bump min confidence from 0.20 → 0.55 for any non-authoritative source.

### 3. `supabase/functions/rapid-basic-card-lookup/index.ts`

- Reject incoming queries where `setCode` is absent AND `title` fails the same `isReadableTitle` check server-side (return `requires_user_disambiguation`).
- Stop building PriceCharting queries from raw OCR text when no structured fields exist (the `[lookup] PC queries: ["o © 0"]` calls in logs).
- When a PriceCharting candidate is found via title-only search, require fuzzy similarity ≥ 0.7 between the candidate name and the submitted title before accepting; otherwise return no match.

### 4. UI surface

`needs_review` items already render in `RecentScansBox`. Update the badge text to "Unreadable — retake" so users immediately see the scan was rejected on purpose, not silently saved as the wrong card.

## Files changed

```
src/lib/ocr/ocrQuality.ts                          (new)
src/lib/queueProcessor.ts                          (gate + remove invent-identity fallback)
src/lib/rapidBasicLookupClient.ts                  (pass through reject reason)
supabase/functions/rapid-basic-card-lookup/index.ts (server-side gate + fuzzy threshold)
components/scanner/RecentScansBox.tsx              (badge wording for needs_review)
```

## Rule being enforced

No printed code, no validated title → no name, no price, no save. The app must read the card, not invent it.
