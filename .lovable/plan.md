

## Why cards appeared in queue but never showed up

Looking at the pipeline in `src/lib/queueProcessor.ts` and `src/components/scanner/RapidScanCamera.tsx`, three real problems can cause "queued but never showed":

### Problem 1 — Cards processed in background never get added to the visible list
`RapidScanCamera.tsx` line 1010–1044: the `recent-scan-added` event handler calls `updateCard(scan.id, ...)` for each recent scan. But `updateCard` (line 445) only **updates existing entries** — it never **adds** new ones:
```ts
setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
```
So if a scan was captured in one session, processed in the background while the user was on another tab/route (right now they're on `/auth`), and then they return to Rapid Scan — the on-mount hydration at line 331 only runs **once**. Any scan completing while the component was unmounted, OR captured from another device (USB/remote), never gets injected into the visible card list.

### Problem 2 — Auth loss silently breaks the save path
The user is currently on `/auth` — likely the session expired mid-batch. When that happens:
- `getUserId()` returns `null`
- `insertCardDual` in SAVE mode is skipped (line 737 checks `userId &&`)
- `addRecentScan` still runs → entry goes to `localStorage`
- `idbDelete(item.id)` still runs → queue item gone

So cards "process" but never make it to the library, and the queue empties. From the user's perspective: queue drained, library empty, no visible result.

### Problem 3 — Storage upload silently swallowed
Lines 662–665: if upload throws, it logs a warning, returns `null`, then line 703 still calls `getPublicUrl(filePath)` for a path that was **never uploaded**. `imageUrl` becomes a broken URL. The card "succeeds" but its image is dead — visually it looks like nothing happened.

## Fix

### File: `src/components/scanner/RapidScanCamera.tsx`
**Change `recent-scan-added` handler to upsert (add new + update existing):**

```ts
const handleRecentScanAdded = () => {
  const recentScans = getRecentScans();
  setCards((prev) => {
    const byId = new Map(prev.map((c) => [c.id, c]));
    for (const scan of recentScans) {
      const existing = byId.get(scan.id);
      const patch = {
        status: "completed" as const,
        cardName: scan.card_name,
        cardSet: scan.card_set ?? undefined,
        cardNumber: scan.card_number ?? undefined,
        playerName: scan.player_name ?? undefined,
        imageUrl: scan.image_url,
        value: scan.price,
        psa10Price: scan.psa10Price ?? null,
        rarity: scan.rarity ?? undefined,
        gameType: scan.gameType ?? undefined,
        sportType: scan.sportType ?? undefined,
        dbId: scan.dbId ?? undefined,
        isInLibrary: !!scan.isInLibrary,
        libraryQuantity: scan.libraryQuantity ?? 0,
        year: scan.year ?? undefined,
        team: scan.team ?? undefined,
        manufacturer: scan.manufacturer ?? undefined,
      };
      if (existing) {
        byId.set(scan.id, { ...existing, ...patch });
      } else {
        // Inject background-processed scans that were never in this session
        byId.set(scan.id, { id: scan.id, ...patch });
      }
    }
    // Preserve ordering: newest first by scanned_at
    return Array.from(byId.values()).sort((a, b) => /* newest first */ 0);
  });
};
```

### File: `src/lib/queueProcessor.ts`
**1. Detect lost auth and pause instead of silently dropping work** — at the top of `processJob`, if `getUserId()` returns null and `scanMode === "SAVE"`, set queue item status back to `queued`, pause processor, and toast "Signed out — sign back in to resume scanning."

**2. Fix the broken-image case** — when `uploadPromise` returns null (upload failed), use a placeholder/local blob URL (`URL.createObjectURL(item.blob)`) for `imageUrl` instead of asking Supabase Storage for a public URL of a file that doesn't exist. Persist a local thumbnail flag in `recentScans` so the UI knows it's local-only.

**3. Don't `idbDelete` on auth-failed save paths** — only delete the IDB item after either (a) a confirmed library insert in SAVE mode, or (b) a successful `addRecentScan` in non-SAVE mode. If neither happens, leave it as `error` for retry.

### Files changed

| File | Change |
|---|---|
| `src/components/scanner/RapidScanCamera.tsx` | Upsert in `recent-scan-added` handler so background-processed cards appear |
| `src/lib/queueProcessor.ts` | Pause-on-auth-loss; fall back to local URL when upload fails; don't delete IDB on silent failures |

### Out of scope
- Phase 1 strict-ordering work
- Settings UI changes
- Edge function changes (pricing is working, per logs)

### Verification
- Capture 5 cards, refresh the page mid-batch → returning to Rapid Scan should show all 5 once processed.
- Sign out mid-batch → toast appears, queue pauses; sign back in and click resume → remaining cards complete.
- Force an upload error (offline) → card still appears with local image instead of broken thumbnail.

