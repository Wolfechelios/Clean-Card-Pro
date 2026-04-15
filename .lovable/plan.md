

## Plan: Always Show Alternatives + Add Manual Search When No Match

### Problem
1. Alternatives only display when confidence is below 95% — high-confidence but wrong identifications show no alternatives
2. When none of the alternatives match, users have no way to search for the correct card manually

### Changes

**1. Always show alternatives in the UI**

**File: `src/components/scanner/CardIdentificationEditor.tsx`**
- Remove the `primaryCard.confidence < 95` gate on `showAlternatives` — always show the alternatives section when alternatives exist
- Add a "None of these? Search manually" button at the bottom of alternatives (and show it even when alternatives list is empty)
- Add a manual search input that lets the user type a card name and calls the `enhanced-card-identify` or a search edge function to fetch new matches
- Display search results as selectable cards in the same alternative format

**2. Always request alternatives from the AI**

**File: `supabase/functions/enhanced-card-identify/index.ts`**
- Change the prompt from "Only include alternatives if confidence < 0.95" to "Always include 2-3 alternative identifications with different sets, printings, or similar cards"

**File: `supabase/functions/rapid-card-identify/index.ts`**
- Same prompt change: always return alternatives

**3. Add a "Search for card" action using existing search function**

**File: `src/components/scanner/CardIdentificationEditor.tsx`**
- Add state for `isSearching`, `searchQuery`, `searchResults`
- Add a collapsible search section with an Input + Search button
- On search, call `supabase.functions.invoke("search-card-details", { body: { query, gameType } })` to find matching cards
- Render results as selectable alternative cards the user can pick

### Files to edit

| File | Changes |
|------|---------|
| `src/components/scanner/CardIdentificationEditor.tsx` | Remove confidence gate on alternatives, add manual search UI with input + results |
| `supabase/functions/enhanced-card-identify/index.ts` | Always return 2-3 alternatives in prompt |
| `supabase/functions/rapid-card-identify/index.ts` | Same: always return alternatives |

### What stays unchanged
- Database schema, pricing engine, queue processor
- The confirm/save flow — selecting a search result just updates the edited name/set like alternatives do today

