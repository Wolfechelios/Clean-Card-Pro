

## Plan: Add COMC as Price Source for MTG and Pokémon

### What
Add COMC (comc.com) as an additional pricing source for MTG and Pokémon cards. Yu-Gi-Oh is excluded because COMC has essentially zero Yu-Gi-Oh inventory.

### COMC Listing Format (from scraping)
Each listing follows this pattern in markdown:
```text
[YEAR SET_NAME - [Base] #CARD_NUMBER](url)
VARIANT - CARD_NAME [CONDITION]
$PRICE
```
Example: `1999 Pokemon Base Set - [Base] #4 | Holo - Charizard [PSA 4 VG‑EX] | $1,131.10`

Conditions include: `NM` / `Near Mint`, `LP` / `Lightly Played`, `MP` / `Moderately Played`, `PSA X`, `CGC X`, `BGS X`.

### Search URL Pattern
- MTG: `https://www.comc.com/Cards/Magic,=CARD_NAME+SET,vList,i100`
- Pokémon: `https://www.comc.com/Cards/Pokemon,=CARD_NAME+SET,vList,i100`

### Changes

**File: `supabase/functions/fetch-card-prices/index.ts`**

1. **Add `fetchCOMCPrices(cardName, cardSet, gameType)` function** (~80 lines)
   - Build search URL using game-specific category path (`/Cards/Magic` or `/Cards/Pokemon`)
   - Scrape via Firecrawl (already used by other scrapers in this file)
   - Parse listings using regex on the structured markdown format:
     - Extract price from `$XX.XX` pattern
     - Extract condition from `[CONDITION]` bracket pattern
     - Filter listings to match card name (fuzzy match)
   - Categorize prices by condition:
     - `NM` / `Near Mint` / `Mint` → raw price candidates
     - `PSA 8` → psa8 candidates
     - `PSA 9` → psa9 candidates  
     - `PSA 10` → psa10 candidates
     - `CGC 9` / `CGC 10` → cgc candidates
   - Return `SourcePrices` (median of each category)

2. **Wire COMC into parallel fetch** (~line 396)
   - Add `comcPromise` for MTG and Pokémon cards (not YGO, not sports)
   - Condition: `isTCG && gameType matches "mtg|magic|pokemon"`
   - Add to `Promise.all` alongside existing fetches

3. **Add COMC prices to aggregation** (~line 406-444)
   - Add COMC to sources list when it returns data
   - Include COMC raw/psa8/psa9/psa10/cgc prices in their respective median candidate arrays
   - For MTG/Pokémon priority: COMC → PriceCharting → TCGPlayer → eBay

4. **Add COMC fields to PricingResult** (optional, for transparency)
   - Add `comcRaw`, `comcUrl` fields so the client can see COMC as a distinct source

### Files to edit

| File | Changes |
|------|---------|
| `supabase/functions/fetch-card-prices/index.ts` | Add `fetchCOMCPrices()` scraper; wire into parallel fetch for MTG + Pokémon; add COMC prices to all median candidate arrays |

### What stays unchanged
- Yu-Gi-Oh pricing (no COMC inventory exists)
- Sports card pricing
- Client-side adapters, consensus engine, UI
- All existing scrapers (eBay, PriceCharting, TCGPlayer, SportsCardPro)

