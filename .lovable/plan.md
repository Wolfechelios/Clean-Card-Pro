
## Fix Verify Match so it shows the actual matching card and useful verification data

### What is wrong now

The current Verify Match flow is technically running, but it feels irrelevant because it is missing the pieces a user expects from “verify”:

1. It only shows the single AI primary result and hides the alternative matches returned by the identification service.
2. It does not show a verified reference image for the matched result, so there is no real visual confirmation.
3. The verification pricing pipeline is weak right now because the client adapters only return TCGPlayer data, even though the UI says it checks multiple sources.
4. In Collections, “Verify Selected” does not actually verify selected cards; it just opens the first card modal and tells the user to click again.
5. The price panel has a duplicate-key warning for repeated flags, which adds noise during verify.

### What to build

#### 1) Make Verify Match show real candidate matches
Update the verification result shape so it includes:
- primary verified match
- alternatives from the identification service
- verified reference image URL for the selected match
- pricing consensus for the selected match

This turns Verify into: identify card -> show likely matches -> let user choose the correct one -> then price that exact choice.

#### 2) Add selectable match candidates inside the verify dialog
Enhance `src/components/pricing/CardVerificationDialog.tsx` to include:
- current card on the left
- verified candidate on the right
- an “Alternative matches” list under the verified section
- tap/click on an alternative to switch the selected verified match
- a verified reference image for the currently selected match

The dialog should feel like a proper review tool, not just an AI text dump.

#### 3) Re-price based on the chosen verified match
Update the verification logic so pricing is recomputed from the selected match, not permanently tied to the first AI primary result.

That means:
- initial open prices the primary match
- selecting another candidate re-runs consensus for that candidate
- Accept Verified saves the currently selected candidate’s fields

#### 4) Fetch a real verified card image for comparison
Use the existing image lookup function to fetch the matched card’s reference image using the verified name/set/game type, and render:
- current scanned image
- verified database/reference image

This gives the user the “pull up the card that matches” behavior they asked for.

#### 5) Strengthen the verification pricing pipeline
The verification pipeline should not pretend to use multiple sources if it only returns one useful source.

Update pricing verification so the default adapters include the intended sources in priority order:
- MTG/Pokémon: local PriceCharting dataset, TCGPlayer, then eBay-derived data as fallback
- Yu-Gi-Oh: PriceCharting/TCGPlayer/eBay fallback as available
- sports: keep current source path logic aligned with existing pricing function

Also avoid double-counting the same underlying edge-function response when building consensus.

#### 6) Make Collections “Verify Selected” behave correctly
Replace the current placeholder behavior in `src/pages/CollectionsPage.tsx` so Verify Selected:
- opens verification directly for the selected card if one is selected
- if multiple are selected, either queue them one-by-one or clearly limit to one for now
- does not rely on a toast telling the user to click somewhere else

### Files to update

- `src/lib/verification/verifyCard.ts`
  - return alternatives from identification
  - support pricing a selected candidate
  - optionally fetch verified reference image for the selected match

- `src/hooks/use-card-verification.ts`
  - manage selected candidate state
  - expose rerun for selected candidate
  - keep loading/error/result consistent when switching matches

- `src/components/pricing/CardVerificationDialog.tsx`
  - render alternatives list
  - render verified reference image
  - allow selecting a candidate
  - accept the currently selected match
  - keep current-vs-verified comparison clear

- `src/lib/pricing/adapters.ts`
  - include the intended source adapters in `getDefaultAdapters`
  - align source priority with project pricing rules
  - avoid misleading “multi-source” verification from a single source

- `src/components/cards/CardDetailModal.tsx`
  - wire Verify Match to the improved dialog
  - ensure accepted selected match updates local modal state immediately

- `src/components/scanner/ScannedCardList.tsx`
  - wire scan-row verify to the improved dialog
  - save the chosen match back into scan state and database row

- `src/pages/CollectionsPage.tsx`
  - make Verify Selected actually launch verification for the selected card(s)

- `src/components/pricing/PriceConsensusPanel.tsx`
  - fix duplicate flag keys by using a stable unique key per rendered badge

### Expected behavior after the fix

When the user taps Verify Match:
1. The app re-identifies the card from the image.
2. It shows the best match plus alternative matches.
3. It pulls up a reference image for the selected verified card.
4. It prices the selected verified card using the proper consensus pipeline.
5. The user can switch to another match if the first one is wrong.
6. Accept Verified saves the exact chosen match’s name, set, number, rarity, game type, sport type, and price if valid.

### Verification checklist

- Verify Match opens with a clear matched card, not generic text
- Alternative matches are visible and selectable
- Selecting an alternative changes the verified card info and reprices it
- Verified reference image appears beside the scanned image
- Accept Verified saves the chosen match fields immediately in both Collections and Rapid Scan
- Verify Selected from Collections opens a real verify flow
- No duplicate-key warning appears in the console from `PriceConsensusPanel`

### Technical details

```text
Verify Match
  -> enhanced-card-identify
      -> primary + alternatives
  -> reference image lookup for selected match
  -> price consensus for selected match
  -> user picks best candidate
  -> accept saves selected candidate
```

No database schema changes are required for this fix. This is a client/edge-function integration refinement using existing tables and existing backend functions.
