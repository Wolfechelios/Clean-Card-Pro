

## Plan: Fix Rapid Scan Card List and Sound Thresholds

### Problems Found

1. **Cards not appearing at bottom**: The sync mechanism between the queue processor and the UI relies on `queueProcessor.lastProcessedCard` updating the local `cards` state. However, if the RapidScanCamera component unmounts and remounts (e.g., tab switch), or if there's a timing gap, cards processed in the background won't appear because the component doesn't listen for the `recent-scan-added` event to re-sync from localStorage. Additionally, the `useEffect` at line 953 only fires when `lastProcessedCard` changes — if the component wasn't mounted when the card was processed, that update is lost.

2. **Sound thresholds wrong**: Ka-ching plays at $10+ (line 978) but user wants $15+. The $50+ jackpot sound fires inside `addRecentScan()` in `recentScans.ts` which IS called by the queue processor — so it should work, but there's no explicit jackpot call in the rapid scan UI sync `useEffect`, meaning the sound only fires if `addRecentScan` succeeds.

### Changes

**1. Add `recent-scan-added` event listener to RapidScanCamera (`src/components/scanner/RapidScanCamera.tsx`)**
- Add a `useEffect` that listens for the `recent-scan-added` custom event
- On each event, re-read `getRecentScans()` and merge any new cards into the local `cards` state that aren't already present
- This ensures cards processed while the component is mounted (or re-mounted) always appear in the list

**2. Fix sound thresholds (`src/components/scanner/RapidScanCamera.tsx`)**
- Change ka-ching threshold from `$10` to `$15` (line 978)
- Add explicit `playJackpotBeep()` call for `$50+` cards in the same `useEffect` (line 953-990), so the jackpot sound fires reliably from the UI sync path too

**3. Update `recentScans.ts` value threshold constant**
- Change `VALUE_THRESHOLD` from `20` to `15` to match the ka-ching threshold for consistency in the "high value" badge

### Files

| File | Action |
|------|--------|
| `src/components/scanner/RapidScanCamera.tsx` | Edit — add event listener for card sync, fix sound thresholds |
| `src/lib/recentScans.ts` | Edit — update VALUE_THRESHOLD to 15 |

### What stays unchanged
All existing scanning, pricing, queueing, card recognition, library, history, microscope, foil trainer, import anomaly detection, and UI functionality remains intact.

