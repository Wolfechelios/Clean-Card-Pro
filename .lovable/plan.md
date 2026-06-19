## Goal

Let you use your external iPhone as the camera **inside the Rapid Scan tab itself** — so phone photos land in the same rapid scan queue, get identified, priced, and (if Save mode is on) saved to your collection, with no extra clicks.

Today the phone pairing flow lives under the separate **Phone (QR)** tab. You want it usable from Rapid Scan without leaving that tab.

## What you'll see

Inside the Rapid Scan tab, a new source switch at the top:

```text
[ This computer's camera ]   [ iPhone (remote) ]
```

- **This computer's camera** (default) — unchanged behavior.
- **iPhone (remote)** — replaces the live webcam panel with the existing pairing UI:
  - QR code + 6-character session code (always pointing at the published site so the phone can log in)
  - Phone scans QR or enters the code → opens the mobile scanner on the iPhone
  - Every photo the iPhone takes is auto-queued and processed by the rapid scan pipeline (identification → pricing → save/preview → recent scans list)
  - The rest of the Rapid Scan UI stays put: queue counter, running total, scanned-cards list, Save vs Scan & Price mode toggle, foil review, etc.

The choice is remembered (saved to scanner settings) so you don't have to flip it every session.

## Why this works with no pipeline changes

`RemoteScanDesktop` already:
- Pushes each phone photo through `compressImageForQueue`
- Inserts into the shared `idbQueue`
- Calls `startProcessor()` on the same `useQueueProcessor` that Rapid Scan uses

So the same workers that handle local captures will pick up the iPhone captures. The rapid scan results list, totals, audio beeps, and Save mode all apply automatically.

## Technical details

1. `src/components/scanner/RapidScanCamera.tsx`
   - Add a `source: "local" | "remote"` state (persisted via `useScannerSettings`, new field `rapidScanSource`, defaulting to `"local"`).
   - Render a small segmented control above the camera viewport.
   - When `source === "remote"`:
     - Skip `getUserMedia` setup / camera permission flow.
     - Hide the local viewfinder, capture button, torch/zoom/focus controls.
     - Render `<RemoteScanDesktop userId={userId} onImageReceived={noop} />` in place of the viewfinder.
     - Keep the existing `ScannedCardList`, totals, queue status, Save/Scan toggle, and foil review queue rendered below.
   - Need `userId` — read from `useAuth()` (already used elsewhere in the file or via `src/hooks/use-auth.tsx`).

2. `src/hooks/use-scanner-settings.ts`
   - Add `rapidScanSource: "local" | "remote"` to the settings type with `"local"` default and a setter.

3. No changes to:
   - `RemoteScanDesktop` / `RemoteScanMobile` (already wired to the queue and the published origin)
   - `queueProcessorV2` / `hybridCardIdentify` (pipeline already shared)
   - The `Phone (QR)` tab in `Scanner.tsx` (kept as-is for users who prefer the dedicated screen)

## Out of scope

- No changes to the identification or pricing logic.
- No changes to the mobile scanner UI on the iPhone.
- Native (Capacitor) builds — this stays a web flow using the published site on the iPhone.
- USB/cable mode — separate tab, untouched.

## Confirm before I build

1. Should the iPhone source toggle be **remembered** across sessions (saved in scanner settings) or reset to local camera each visit?
2. When iPhone mode is active, should the **Save vs Scan & Price** toggle and **foil review queue** stay visible on the desktop Rapid Scan screen (recommended), or be hidden to keep the screen minimal?
