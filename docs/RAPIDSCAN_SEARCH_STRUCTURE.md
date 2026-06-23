# RapidScan Search Structure

RapidScan should identify first, then price. Prices must never be guessed from OCR text alone.

## Active flow

```txt
RapidScan camera frame
  ↓
idbQueue queued image
  ↓
queueProcessor
  ↓
OCR with zai-ocr
  ↓
rapid-basic-card-lookup edge function
  ↓
1. PriceCharting set-code/title search
  ↓ no match
2. Google Lens URL search from uploaded public image
  ↓ no match
3. Google web search site:pricecharting.com
  ↓ no match
4. DuckDuckGo site:pricecharting.com
  ↓ no match
5. Bing site:pricecharting.com
  ↓
Matched PriceCharting product page
  ↓
Parse raw / PSA / CGC prices
  ↓
Save card / recent scan
```

## Files

```txt
src/lib/queueProcessor.ts
  RapidScan queue worker. Uploads scan image, gets OCR text, calls rapid-basic-card-lookup, then saves the matched card.

supabase/functions/zai-ocr/index.ts
  OCR extraction for set code, title, card number, and raw text.

supabase/functions/rapid-basic-card-lookup/index.ts
  Basic lookup brain. Searches PriceCharting first. Uses Google Lens only if PriceCharting direct lookup fails. Prices are parsed only after a PriceCharting product URL is found.

supabase/migrations/20260623000100_rapidscan_card_images_public.sql
  Keeps card-images public so Google Lens can read uploaded scan images.

supabase/config.toml
  Registers rapid-basic-card-lookup for Supabase local/deploy tooling.
```

## Edit points

To add another search source, edit:

```txt
supabase/functions/rapid-basic-card-lookup/index.ts
```

Add the source after Google Lens and before final failure. Return a `Candidate` with:

```ts
{
  name: string;
  url: string; // must be a PriceCharting /game/ URL
  source: string;
  score: number;
}
```

To change OCR priority, edit `compactOcrText()` usage inside:

```txt
src/lib/queueProcessor.ts
```

Current priority:

```txt
setCode
cardNumber
title
name
raw OCR text
```

## Rule

No identity, no price. No PriceCharting product URL, no price parse.
