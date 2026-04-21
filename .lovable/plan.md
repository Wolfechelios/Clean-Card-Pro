

## Fix: Verify dialog doesn't fill in card info after accepting

### Problem

After clicking "Accept Verified" in the verification dialog, none of the card fields (set, rarity, number, etc.) are updated on the card record. The dialog closes but nothing changes.

### Root cause

Two bugs in the accept-flow wiring:

1. **`CardDetailModal.tsx`** — The `onAccept` handler likely either (a) isn't wired to a DB update at all, or (b) only updates a subset of fields and skips `rarity` because `VerifyAcceptPatch` doesn't include it. Looking at `CardVerificationDialog.tsx`, the patch shape is:
   ```
   { card_name, card_set, card_number, rarity, game_type, sport_type, current_price_raw }
   ```
   But the `VerifyAcceptPatch` interface in the dialog file is **missing `rarity`** in its TypeScript declaration even though the runtime object includes it — and consumers typed against the interface won't pass it through.

2. **`ScannedCardList.tsx` / `CollectionsPage.tsx`** — The `onAccept` callback in the Rapid Scan list and Collections most likely just closes the dialog and doesn't call `supabase.from("cards").update(patch).eq("id", card.id)` + `updateCardDual` to persist + mirror to local IndexedDB.

### Fix

| File | Change |
|---|---|
| `src/components/pricing/CardVerificationDialog.tsx` | Add `rarity: string \| null` to the `VerifyAcceptPatch` interface so it matches the runtime object being passed to `onAccept` |
| `src/components/cards/CardDetailModal.tsx` | Implement the `onAccept` handler: call `updateCardDual(card.id, patch)`, update local component state with the new field values so the modal reflects changes immediately, show a success toast, and call `onCardChange?.()` to trigger Collections refetch |
| `src/components/scanner/ScannedCardList.tsx` | In the verify dialog `onAccept`, call `onCardUpdate(card.id, { card_name, card_set, card_number, rarity, game_type, current_price_raw })` so the scan row updates in place; if the card has a `dbId`, also call `updateCardDual(dbId, patch)` to persist |
| `src/pages/CollectionsPage.tsx` | After accept in the bulk-verify path, call `supabase.from("cards").update(patch).eq("id", id)` then `fetchCards()` to refresh the grid |
| `src/lib/verification/verifyCard.ts` | Confirm `VerifiedIdentification` includes `rarity` (it does) — no change, but verify it propagates through the patch |

### Behavior after fix

1. User taps Verify → dialog opens, runs identification + price consensus
2. Verified Match shows the new name/set/number/rarity
3. User taps **Accept Verified**
4. Patch is applied via `updateCardDual` → DB updated, local IndexedDB mirrored
5. Toast: "Card updated from verification"
6. Modal/list/grid reflects new values immediately (no manual refresh)
7. `price_history` row inserted with `source: 'verification'` for audit trail

### Verification

- Open any card with wrong/missing set+rarity, click Verify
- Click Accept Verified
- Confirm the modal immediately shows the new set, rarity, number, and price
- Close modal, reload Collections — values persist
- Check `cards` table: row reflects new values
- Check `price_history`: new row with `source='verification'`

