

## Plan: Add Game Type Selector to Rapid Scan

### Problem
The AI vision model guesses `game_type` from the image, and sometimes gets it wrong (e.g., labeling an MTG card as Yu-Gi-Oh). This causes wrong pricing lookups. There's no way for the user to constrain what type of cards they're scanning.

### Solution
Add a persistent "Card Type" selector to scanner settings and display it prominently in the Rapid Scan UI. When set, the selected game type is passed through to the AI identification prompt, forcing correct classification.

### Changes

**1. Add `gameTypeFilter` to scanner settings**

**File: `src/hooks/use-scanner-settings.ts`**
- Add `gameTypeFilter: string` to `ScannerSettings` interface (default: `"auto"`)
- Options: `"auto"`, `"mtg"`, `"yugioh"`, `"pokemon"`, `"sports"`, `"gpk"`, `"marvel"`, `"onepiece"`, `"other"`

**2. Show game type selector in Rapid Scan camera UI**

**File: `src/components/scanner/RapidScanCamera.tsx`**
- Add a compact chip/select row above the camera viewfinder showing the current game type filter
- Use `Select` component with labeled options (Auto Detect, Magic: The Gathering, Yu-Gi-Oh!, Pokémon, Sports, GPK, Marvel, One Piece, Other)
- Persist via `updateSettings({ gameTypeFilter: value })`

**3. Pass game type hint through the queue processor**

**File: `src/lib/queueProcessor.ts`**
- Read `getScannerSettings().gameTypeFilter` before calling `hybridIdentifyCard`
- Pass it as a new `gameTypeHint` option

**4. Thread hint through hybrid identify to the edge function**

**File: `src/lib/hybridCardIdentify.ts`**
- Add `gameTypeHint?: string` to the options parameter
- Pass it in the edge function body: `{ imageUrl, ocrText, gameTypeHint }`

**5. Use the hint in the AI prompt**

**File: `supabase/functions/rapid-card-identify/index.ts`**
- Accept `gameTypeHint` from the request body
- When not `"auto"`, prepend to prompt: `"IMPORTANT: The user has confirmed this is a [Game Type] card. Set game_type to '[value]' — do not guess a different game type."`
- Also apply the hint as a post-processing override: force `cardData.game_type` to the canonical value

**6. Same hint in enhanced-card-identify**

**File: `supabase/functions/enhanced-card-identify/index.ts`**
- Same pattern: accept `gameTypeHint`, inject into prompt, override result

### Game Type Mapping

| Selector Label | `gameTypeFilter` value | Canonical `game_type` |
|---|---|---|
| Auto Detect | `auto` | (AI decides) |
| Magic: The Gathering | `mtg` | `MTG` |
| Yu-Gi-Oh! | `yugioh` | `Yu-Gi-Oh!` |
| Pokémon | `pokemon` | `Pokemon` |
| Sports | `sports` | `Sports` |
| Garbage Pail Kids | `gpk` | `GPK` |
| Marvel | `marvel` | `Marvel` |
| One Piece | `onepiece` | `One Piece` |
| Other | `other` | (AI decides, but prompted as "not any major TCG") |

### Files to edit

| File | Changes |
|------|---------|
| `src/hooks/use-scanner-settings.ts` | Add `gameTypeFilter` field |
| `src/components/scanner/RapidScanCamera.tsx` | Add game type selector UI above viewfinder |
| `src/lib/queueProcessor.ts` | Read setting, pass `gameTypeHint` to `hybridIdentifyCard` |
| `src/lib/hybridCardIdentify.ts` | Thread `gameTypeHint` to edge function body |
| `supabase/functions/rapid-card-identify/index.ts` | Accept hint, inject into prompt, override result |
| `supabase/functions/enhanced-card-identify/index.ts` | Same hint support |

### What stays unchanged
- Pricing engine, COMC integration, all other scrapers
- Database schema — no new tables or columns
- Upload tab and USB tab (can add later if needed)

