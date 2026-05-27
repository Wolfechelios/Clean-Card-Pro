## Goal

While the Rapid Scan camera is open, the app should **only capture** photos into the IndexedDB queue. The identify + pricing pipeline (`queueProcessor`) should not run until the scanner is stopped, then it drains the queue automatically.

This avoids CPU/network contention with the camera and gives a true "scan now, process later" flow.

## Current behavior

- Capture already enqueues to IndexedDB (`idbQueue`) — that part is correct.
- The processor that does identify + pricing (`useQueueProcessor`) is started in **three** places that fire even when the scanner is active:
  1. `useQueueAutoResume` on mount (`checkAndResumeQueue()`).
  2. Same hook on window `focus` / `visibilitychange` → `state.start()`.
  3. Inside `RapidScanCamera` on unmount (line 800) — this one is actually desired.
- `useGlobalProcessControl.scannerActive` is already toggled when the camera is on, so we have a clean gate.

## Change

### 1. `src/hooks/use-queue-auto-resume.ts`
Gate every auto-start on `useGlobalProcessControl.getState().scannerActive === false`. Specifically:
- Wrap `checkAndResumeQueue()` on mount in a scanner-active check; skip when active.
- In the `recheck` handler (focus / visibility), bail out if `scannerActive` is true.

### 2. `src/lib/queueProcessor.ts` — defensive gate
In the `start()` action, return early (no-op + console log) when `useGlobalProcessControl.getState().scannerActive` is true and the call is not explicitly user-initiated. Add an optional `force?: boolean` arg so the manual "Start lookup" button in `ScanQueuePanel` and the unmount drain in `RapidScanCamera` can bypass the gate by passing `true`.

### 3. `src/components/scanner/RapidScanCamera.tsx`
- Unmount drain (line 800) → call `start(true)` so leaving `/scan` still kicks off processing.
- Add a second drain trigger: when `cameraOn` flips from `true → false` (user presses Stop on the camera but stays on the page), if `idbCountQueued() > 0`, call `useQueueProcessor.getState().start(true)`.

### 4. `src/components/scanner/ScanQueuePanel.tsx` — UX clarity
When `scannerActive` is true:
- Show a small inline notice: "Processing paused while scanning — queue will run when you stop." (uses `text-muted-foreground`, semantic tokens only).
- Keep the manual **Start lookup** button enabled; clicking it calls `start(true)` so power users can override.

No other files change. No schema, no pricing-logic, no capture-pipeline changes.

## Validation

1. Open `/scan`, start camera, snap 5 cards. Confirm:
   - `ScanQueuePanel` shows "5 queued", **0 processing**, and the "paused while scanning" notice.
   - No identify / pricing edge-function calls in the network panel.
2. Press Stop on the camera (still on `/scan`). Processor should auto-start and queue count should drop.
3. Repeat, but instead of pressing Stop, navigate away to `/dashboard`. Unmount drain should kick in — queue processes in background.
4. While scanner is active, manually click **Start lookup** in `ScanQueuePanel`. Override should work and processing should begin even with camera open.
5. Refresh the tab while items are queued and camera is closed → `useQueueAutoResume` resumes processing as before.
