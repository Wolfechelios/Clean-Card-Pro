

## Plan: Fix Yu-Gi-Oh Set Misidentification (Honest SDBE-EN017 = $90 bug)

### Root Cause
The AI identified "SDBE-EN017" as belonging to "Speed Duel: Battle City Box" instead of "Saga of Blue-Eyes White Dragon Structure Deck". The pricing engine correctly returned $93 for the wrong set. The real price is $0.24.

The AI prompt already extracts the set code correctly (SDBE-EN017), but there's no post-processing step to **verify the set code against a real Yu-Gi-Oh database** — unlike MTG which has Scryfall validation.

### Changes

**1. Add YGOPRODeck API lookup to officialNameResolver.ts**

**File: `supabase/functions/_shared/officialNameResolver.ts`**

Add a new function `lookupYgoBySetCode(setCode: string)` that calls the free YGOPRODeck API:
- `https://db.ygoprodeck.com/api/v7/cardinfo.php?name={cardName}` — returns all printings with set codes
- Or use the card number approach: parse the set prefix (e.g., "SDBE") and card number, then look up via the API to get the **official set name**
- This returns the correct set name, card name, and rarity for the exact printing

Update `resolveOfficialCardIdentity()` to call this for Yu-Gi-Oh cards when a set code is detected, overriding the AI's guessed set name with the database-verified one.

**2. Add set code validation in enhanced-card-identify post-processing**

**File: `supabase/functions/enhanced-card-identify/index.ts`**

After the AI returns its identification, if `game_type` is Yu-Gi-Oh and `card_number` matches the YGO set code regex (`/^[A-Z0-9]{2,5}-[A-Z]{0,2}\d{3}$/`):
- Call `lookupYgoBySetCode()` to verify the set name
- If the API returns a different set name, override it and log the correction
- This prevents incorrect set names from propagating to the pricing engine

**3. Same fix in rapid-card-identify post-processing**

**File: `supabase/functions/rapid-card-identify/index.ts`**

Apply the same YGOPRODeck lookup after parsing the AI response, before returning `cardData`.

### Files to edit

| File | Changes |
|------|---------|
| `supabase/functions/_shared/officialNameResolver.ts` | Add `lookupYgoBySetCode(cardNumber)` using YGOPRODeck API; integrate into `resolveOfficialCardIdentity` for YGO cards |
| `supabase/functions/enhanced-card-identify/index.ts` | Call YGO set code verification in post-processing (where `resolveOfficialCardIdentity` is already called) |
| `supabase/functions/rapid-card-identify/index.ts` | Add same YGO set code verification before returning cardData |

### What stays unchanged
- Pricing engine (`fetch-card-prices`) — works correctly when given the right data
- All client-side code, UI, database schema
- MTG/Pokemon/Sports identification paths

### Expected result
Scanning "Honest SDBE-EN017" → YGOPRODeck confirms set = "Saga of Blue-Eyes White Dragon Structure Deck" → price = $0.24 instead of $93.88.

