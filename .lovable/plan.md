## Symptom

When the rapid-scan camera opens, the live preview flashes for ~1 second then disappears (black/empty viewfinder, no toast).

## Most likely cause

The constraint upgrade I just shipped in `RapidScanCamera.startCamera` requests, in a single `getUserMedia` call:

- 4K `width/height` (3840×2160)
- `aspectRatio: 16/9`
- An `advanced: [...]` array containing `focusMode`, `exposureMode`, and `whiteBalanceMode` set to `continuous`

On iOS 26 Safari/WKWebView these `advanced` entries are honored at the time of `getUserMedia`. If any single one fails (and `whiteBalanceMode` is not exposed on iOS WebKit), Safari grants the stream momentarily and then drops the track shortly after with an `ended`/`mute` event — which leaves us with a video element that briefly painted a frame and then went blank. The outer try/catch never fires because `getUserMedia` resolved.

A secondary contributor: under React StrictMode the effect mounts twice; my `startingCameraRef` blocks the second `startCamera`, but if the first stream ends silently we have no recovery path.

## Fix

1. **Stop putting `advanced` modes into `getUserMedia`.** Keep the initial call to just `width/height/frameRate/facingMode/deviceId`. Apply `focusMode`, `exposureMode`, `whiteBalanceMode` afterwards via `track.applyConstraints({ advanced: [...] })` inside individual try/catch blocks so one unsupported key cannot kill the stream.
2. **Make 4K a soft fallback.** Try 4K first; on `OverconstrainedError` or if the resulting track ends within 500 ms, retry with 1920×1080. Today the only fallback is "error toast → camera off".
3. **Listen for `track.onended` / `onmute`.** Log and auto-restart once with the safer constraint set instead of leaving a black viewfinder.
4. **Drop `aspectRatio: 16/9`.** It conflicts with the native sensor crop on some iPhone optics and is not needed.
5. **Add a single `[Camera]` console log** on success / fallback / end so this is easy to diagnose next time.

No business logic, OCR pipeline, or UI changes — purely the camera startup path in `src/components/scanner/RapidScanCamera.tsx` (`startCamera` function, ~lines 565–667).

## Validation

- Open `/scan` on iPhone 17 Pro: preview should stay live indefinitely.
- Console should log `[Camera] started 3840×2160` (or `… fallback 1920×1080`).
- Capture a card; preview must remain live after capture (no regression).
- Open on desktop Chrome and an older iPhone: must still work without the `advanced` keys.

## Out of scope

Capture, compression, OCR routing, and queue behavior remain as last shipped.
