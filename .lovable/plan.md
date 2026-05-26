## Why the button isn't showing

The AF button I added is wrapped in `cameraOn && support.focus`. `support.focus` comes from `detectSupport(track)`, which reads `MediaStreamTrack.getCapabilities().focusMode`. Most desktop webcams (and some mobile browser/camera combos) return nothing for `focusMode` even when the camera autofocuses fine on its own — so the button is hidden on your current device.

## Change

In `src/components/scanner/RapidScanCamera.tsx`:

1. Drop the `support.focus` gate from the AF overlay button (line ~1812). Render it whenever `cameraOn` is true.
2. In the button's click handler, branch on `support.focus`:
   - If supported: do the current manual→continuous nudge to retrigger AF lock.
   - If not supported: still issue a best-effort `applyConstraints({ advanced: [{ focusMode: "continuous" }] })` inside try/catch, and show a brief "Refocusing…" overlay either way so the button always feels responsive.
3. Keep the green dot + "AF" label and the top-right placement so it doesn't conflict with the zoom strip on the right edge.

No other files change. Tap-to-focus on the video and continuous AF on camera start stay as they are.

## Validation

- Open `/scan` on desktop preview → AF button visible top-right once camera is on; clicking it shows "Refocusing…" and doesn't error.
- On iPhone (where `focusMode` is reported) → same button, and the nudge actually retriggers focus lock as before.
