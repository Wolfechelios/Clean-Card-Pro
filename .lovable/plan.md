

## Add "Verify" button to Rapid Scan + Collection

A manual verification action that re-runs identification + price consensus on demand, shows the matched card with full source breakdown, and lets the user accept or reject the result.

### What it does

When the user taps **Verify** on a scanned card (Rapid Scan list) or a collection card (Collection grid/detail):
1. Re-runs card identification using the stored image
2. Pulls fresh prices from all sources (PriceCharting, TCGPlayer, eBay, SCP)
3. Runs the result through the consensus/anomaly gate
4. Opens a side-by-side dialog: **Current data ↔ Verified match**
5. User can **Accept** (writes verified name/set/number/price to record) or **Reject** (keeps existing)

### UI changes

**`src/components/scanner/ScannedCardList.tsx`** — Add a `ShieldCheck` icon button next to the existing edit/delete icons on each completed scan row. Disabled while verifying (spinner).

**`src/pages/CollectionsPage.tsx`** — Add a "Verify" action to the bulk action toolbar (verifies all selected) and a single "Verify" button inside `CardDetailModal`.

**New: `src/components/pricing/CardVerificationDialog.tsx`** — Two-column dialog:
- Left: current card (image, name, set, number, current price)
- Right: verified result (matched name, set, number, consensus price range, confidence bar, source quote list)
- Footer: `Accept Verified` / `Reject` / `Re-run`
- Reuses `PriceConsensusPanel` for the right-side price breakdown

### Data flow

```text
Verify button
   │
   ▼
verifyCard(card)  ← new helper in src/lib/verification/verifyCard.ts
   │
   ├─► supabase.functions.invoke("enhanced-card-identify", { imageUrl })
   │      → returns { cardData, alternatives }
   │
   ├─► verifyCardPrice(identity)  ← existing pipeline
   │      → returns PriceConsensus
   │
   └─► returns { identification, consensus, needsReview }
        │
        ▼
   CardVerificationDialog renders result
        │
        ▼
   onAccept → supabase.from("cards").update({...})
              + recordPriceHistory()
```

### Files to create / edit

| File | Change |
|---|---|
| `src/lib/verification/verifyCard.ts` (new) | `verifyCard(card)` orchestrator: re-identify + price consensus, returns combined result |
| `src/hooks/use-card-verification.ts` (new) | Hook wrapping `verifyCard` with loading/error/result state |
| `src/components/pricing/CardVerificationDialog.tsx` (new) | Side-by-side comparison dialog using `PriceConsensusPanel` |
| `src/components/scanner/ScannedCardList.tsx` | Add Verify icon button per row; wires `onVerify(card)` |
| `src/components/scanner/RapidScanCamera.tsx` | Pass `onVerify` handler that opens `CardVerificationDialog`; on accept, call `updateCard(id, patch)` |
| `src/pages/CollectionsPage.tsx` | Add "Verify Selected" toolbar button + single-card verify in detail modal; on accept, update DB row + invalidate React Query cache |
| `src/components/CardDetailModal.tsx` | Add "Verify" button in footer that opens `CardVerificationDialog` |

### Behavior rules

- **Pricing**: uses existing `verifyCardPrice` → consensus engine already enforces anomaly gates per `mem://pricing/consensus-and-anomaly-gate`
- **If `needsReview === true`**: Accept button disabled, "Manual review required" badge shown, only Reject/Re-run available
- **Cache**: verification results cached 4h via existing `consensusCache`; "Re-run" button bypasses cache
- **Bulk verify (Collection)**: processes max 5 in parallel, shows per-row progress, results queued in a review drawer (one accept/reject per card — no auto-write)
- **Cost**: each verify = 1 identify call + up to 5 price calls; show a small "1 verification ≈ X API calls" hint in the dialog

### Out of scope
- Auto-verify on every scan (keeps API cost predictable; manual only)
- Image re-capture from Verify dialog
- History log of past verifications

### Verification
- Rapid Scan: verify a card you know is correct → matched name/price appears, Accept updates the row
- Rapid Scan: verify the $1,000 "Jinx" → consensus flags anomaly, Accept disabled, Reject keeps card
- Collection: select 3 cards, click "Verify Selected" → drawer shows 3 results with individual accept/reject
- CardDetailModal: open any card, click Verify → dialog opens with current vs verified, accept persists to DB

