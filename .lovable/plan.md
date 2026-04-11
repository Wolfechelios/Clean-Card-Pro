

## Plan: Improve MTG Card Identification with Year and Set Disambiguation

### Problem
MTG cards with the same name exist across many sets and years (e.g., "Lightning Bolt" in Alpha 1993, M10 2009, M11 2010, etc.). Currently the AI prompt doesn't emphasize MTG-specific visual cues, the Scryfall resolver only looks up by set code + collector number (missing when not detected), and there's no fallback search by card name + set name. This means reprints often get misidentified or lumped together.

### Changes

**1. Enhance AI prompt for MTG-specific identification**

**File: `supabase/functions/enhanced-card-identify/index.ts`**
- Add an MTG-specific section to the prompt (similar to the existing Yu-Gi-Oh ROI section) instructing the AI to:
  - Read the **set symbol** (bottom-center-right of card) and describe its shape/color to determine set and rarity
  - Read the **collector number** (bottom-left, format `123/280`)
  - Read the **copyright year** at the very bottom (e.g., "© 2010 Wizards...")
  - Distinguish frame styles: pre-8th Edition (old border), 8th-M15 (modern border), M15+ (updated holofoil stamp), post-2024 frames
  - Always populate `year`, `card_set`, and `card_number` fields for MTG cards

**2. Add Scryfall name+set search fallback**

**File: `supabase/functions/_shared/officialNameResolver.ts`**
- Add a new function `lookupMtgByNameAndSet(cardName, cardSet, year)` that uses Scryfall's `/cards/search?q=!"name"+set:code` API when set code + collector number lookup fails
- If year is available, filter Scryfall results by `released_at` year to pick the correct printing
- Extract and return `set_name`, `collector_number`, `released_at` (year) from the matched result
- Update `resolveOfficialCardIdentity` to try this fallback when `lookupMtgBySetAndNumber` returns null

**3. Improve MTG normalization to extract year from copyright**

**File: `supabase/functions/normalize-cards/index.ts`**
- In `normalizeMTG()`, add regex to extract year from card_set or card_name fields (e.g., "Core Set 2021" → year 2021, "Fourth Edition" → year 1995)
- Map common MTG set name patterns to set codes (e.g., "Revised" → "3ED", "10th Edition" → "10E")
- Populate the `year` field on the cards table when detected

**4. Store year from Scryfall in resolver**

**File: `supabase/functions/_shared/officialNameResolver.ts`**
- When Scryfall returns data, extract the year from `released_at` and include it in the resolved result
- Update the return type to optionally include `year`
- In `resolveOfficialCardIdentity`, propagate `year` back to the card object

### Files to edit

| File | Changes |
|------|---------|
| `supabase/functions/enhanced-card-identify/index.ts` | Add MTG-specific prompt section for set symbol, collector number, copyright year, and frame style detection |
| `supabase/functions/_shared/officialNameResolver.ts` | Add `lookupMtgByNameAndSet` fallback using Scryfall search API; return year from `released_at`; update resolver to propagate year |
| `supabase/functions/normalize-cards/index.ts` | Enhance `normalizeMTG` to extract year from set names and populate `year` field |

### What stays unchanged
- Database schema (already has `year`, `card_set`, `card_number`, `set_code` columns)
- Client-side code, UI components, pricing logic
- Yu-Gi-Oh and Pokémon identification paths

