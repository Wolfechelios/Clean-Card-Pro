## What's actually happening

You're right — Helmdale is a real card you own (saved 0 times in your collection — confirmed). The problem is the **Recent Scans list** keeps showing it many times.

Looking at `src/lib/recentScans.ts`, the `addRecentScan` function has **no deduplication at all**. Every single identification result gets pushed as a new entry, even if it's the same card scanned 5 seconds ago. So if you:

- Re-scanned the Helmdale card a few times to get focus right, OR
- The queue processed a buffered photo of it more than once, OR
- The auto-save loop fired multiple times on the same physical card

…each result gets its own row in Recent Scans, up to 500 deep. None of them duplicate to the database (your collection is fine — only 1 row would be added or quantity bumped via `insertCardDual`), but the *visual list* shows it 4–8 times.

## Fix — dedupe in `recentScans.ts`

Change `addRecentScan` to merge same-card scans inside a short window instead of stacking them:

**Logic:**
1. Build a dedupe key from `card_name + card_set + card_number` (lowercased, trimmed). If the card has a `dbId`, prefer that as the key.
2. Before inserting, scan the existing list:
   - If a matching scan exists within the **last 60 seconds** → **update it in place** (refresh `scanned_at`, refresh `price`/`psa10Price` if higher, increment a new `scanCount` field). Do NOT add a new row.
   - Otherwise → insert as a new row (current behavior).
3. Add an optional `scanCount?: number` field to `RecentScan` (default 1). Show "×N" badge on the chip when > 1.

**Why 60s and not longer:** If you scan the same card again 5 minutes later you probably do want to see it as a fresh entry (you set it down and came back to it). A 60s window only collapses the rapid-fire re-scan / queue-replay case that's causing the spam.

## UI touch (optional, ~5 lines)

In whichever component renders the Recent Scans chips (likely `src/components/scanner/RecentScansList.tsx` or similar), if `scan.scanCount && scan.scanCount > 1`, show a small `×{scanCount}` badge in the corner so you can tell at a glance which cards were re-scanned vs. truly new finds.

## Files changed

- `src/lib/recentScans.ts` — add dedupe-merge logic in `addRecentScan`, add `scanCount` field to interface
- The component rendering recent scan chips — render `×N` badge when scanCount > 1 (I'll locate it during implementation)

No DB migration. No edge function changes. ~25 lines of code.

## What you'll see after

- Scan Helmdale 5 times in a row → **1 chip** in Recent Scans with "×5" badge (instead of 5 chips).
- Scan Helmdale, then 10 other cards, then Helmdale again → 2 separate Helmdale chips (correct — that's a real second sighting).
- Your collection database is and was unaffected — Helmdale is saved exactly once with quantity bumping handled by the existing `insertCardDual` dedupe.
