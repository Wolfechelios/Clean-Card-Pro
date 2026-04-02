

## Plan: Highlight Cards from Top 10 Yu-Gi-Oh! Sets

### What
Create a shared constant list of premium Yu-Gi-Oh! set codes and apply a gold/amber highlight border + badge to any card matching those sets across all card display surfaces.

### Premium Sets List
LOB, PGD, IOC, DCR (Dark Crisis), MRD, BCTP, FET (Flaming Eternity), DB1, DB2, STOR (Storm of Ragnarok), SOI

Will match both set codes and full set names via case-insensitive substring matching (e.g. "Legend of Blue-Eyes" or "LOB").

### Changes

**1. New utility file `src/lib/premiumSets.ts`**
- Export a `PREMIUM_YUGIOH_SETS` array of `{ code, name }` objects for all 10 sets
- Export `isPremiumYugiohSet(cardSet: string | null | undefined): boolean` — checks if the card set matches any code or name (case-insensitive substring)

**2. `src/components/collections/CardThumbnail.tsx`**
- Import `isPremiumYugiohSet`
- Add a gold/amber ring + subtle gradient glow when `isPremiumYugiohSet(cardSet)` is true
- Add a small "TOP SET" or crown badge in the corner

**3. `src/components/scanner/ScannedCardList.tsx`**
- Import `isPremiumYugiohSet`
- In `renderCardRow`, add gold left-border or background tint + a "Premium Set" badge when matched

**4. `src/components/scanner/RecentScansBox.tsx`**
- Import `isPremiumYugiohSet`
- Add gold highlight to matching scan rows

### Files

| File | Action |
|------|--------|
| `src/lib/premiumSets.ts` | Create — set list + matcher function |
| `src/components/collections/CardThumbnail.tsx` | Edit — gold border + badge |
| `src/components/scanner/ScannedCardList.tsx` | Edit — gold row highlight + badge |
| `src/components/scanner/RecentScansBox.tsx` | Edit — gold row highlight |

