

## Plan: Fix Recent Scans Cap and Strengthen Anomaly Detection

### Problems

1. **Recent scans capped at 100**: `recentScans.ts` line 79 does `.slice(0, 100)`, so scanning 164 cards loses 64 entries when you navigate away and back.

2. **Same name repeating despite anomaly detector**: The detector pauses at 5 consecutive, but:
   - `checkAndResumeQueue()` calls `start()` which resets `isPaused: false`, so navigating away and back auto-resumes the broken queue
   - The detector never calls `resetSession()` anywhere, so state accumulates but the pause is easily overridden
   - After pause, the queue still has 100+ images queued with the same bad result — resuming just repeats the problem

### Changes

**1. Increase recent scans cap (`src/lib/recentScans.ts`)**
- Change `.slice(0, 100)` to `.slice(0, 500)` so large rapid scan sessions are fully preserved

**2. Make anomaly auto-pause stick across navigation (`src/lib/queueProcessor.ts`)**
- Add a `isPausedByAnomaly: boolean` flag to the store
- When anomaly detector triggers at 5+, set both `isPaused` and `isPausedByAnomaly` to true
- Normal `resume()` clears both flags (user explicitly chose to resume)

**3. Prevent auto-resume from overriding anomaly pause (`src/hooks/use-queue-auto-resume.ts`)**
- Before calling `start()`, check if `isPausedByAnomaly` is true
- If so, resume in paused state (set `isRunning: true` but keep `isPaused: true`) and show a toast explaining why

**4. Auto-stop (not just pause) after 10 consecutive same name (`src/lib/queueProcessor.ts`)**
- At 10 consecutive identical identifications, call `stop()` instead of just pausing, and show an error toast
- Mark remaining queued items as "error" status so they don't auto-resume

**5. Reset anomaly detector on explicit queue start (`src/lib/queueProcessor.ts`)**
- Call `queueAnomalyDetector.resetSession()` inside `start()` so a fresh scan session gets a clean slate

### Files

| File | Action |
|------|--------|
| `src/lib/recentScans.ts` | Increase cap from 100 to 500 |
| `src/lib/queueProcessor.ts` | Add `isPausedByAnomaly` flag, auto-stop at 10 consecutive, reset detector on start |
| `src/hooks/use-queue-auto-resume.ts` | Respect anomaly pause on auto-resume |

### What stays unchanged
All scanning, pricing, camera, microscope, import, and UI functionality remains intact.

