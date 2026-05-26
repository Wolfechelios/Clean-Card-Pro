# Fix: iPhone 17 Pro preview cuts off ~3s after camera starts

## Symptom
On iPhone 17 Pro (iOS 26 WebKit), the rapid-scan preview starts, paints for a couple of seconds, then the video element goes black and the track ends — even though `getUserMedia` already returned a healthy stream.

## Root cause
Right after the stream goes live, `RapidScanCamera.startCamera` and friends fire **a flood of `track.applyConstraints({ advanced: [...] })` calls** at the brand-new iOS track:

1. `safeApply({ focusMode: "continuous" })`
2. `safeApply({ exposureMode: "continuous" })`
3. `safeApply({ whiteBalanceMode: "continuous" })`
4. `applyFastAutofocus(stream, true)` — applies a single batched `advanced` array containing `focusMode`, **`focusDistance: minDist` (macro override)**, `exposureMode`, `whiteBalanceMode`, `exposureCompensation`, `sharpness`, `contrast`, `saturation`, `iso`, then a second call with `whiteBalanceMode: "manual" + colorTemperature: 5500`.
5. A separate `useEffect([cameraOn])` then re-applies `focusMode: continuous` again.

iOS 26 WebKit terminates the `MediaStreamTrack` shortly after an `advanced` set that contains a key it doesn't actually accept (even when wrapped in try/catch, because the rejection happens after the constraint is partially staged). `focusDistance` (manual macro), `iso`, `sharpness`, `contrast`, `saturation`, and `whiteBalanceMode: "manual"` are the usual offenders on Apple cameras — and we apply all of them within the first ~1s. That matches the "starts, dies ~2–3s later" symptom.

Our existing `ended` listener correctly fires `setCameraOn(false)` and shows "Camera dropped" — which is exactly what the user is seeing.

## Fix (scope: client-side camera only)

Edit only `src/components/scanner/RapidScanCamera.tsx` and `src/lib/camera-optimizations.ts`. No backend, OCR, queue, or UI changes.

### 1. `src/components/scanner/RapidScanCamera.tsx` — `startCamera`
- Detect iOS once (`/iPhone|iPad|iPod/i.test(navigator.userAgent)`).
- On iOS: **skip the post-start `safeApply` calls entirely** and **skip `applyFastAutofocus`**. iOS already runs continuous AF / AE / AWB by default on the rear wide camera; we don't need to ask. Set `cameraOn` and exit.
- On non-iOS: keep current behavior (safeApply triad + `applyFastAutofocus`).
- Keep the existing `buildConstraints` (1080p → 720p fallback), the `ended`/`mute` listeners, and the stale-track guard. Those are working.

### 2. `src/components/scanner/RapidScanCamera.tsx` — auto-focus `useEffect` (line ~829)
- Gate it behind the same non-iOS check. On iOS it just re-issues `focusMode: continuous` for no benefit and adds another `applyConstraints` call that can race the track lifecycle.

### 3. `src/lib/camera-optimizations.ts` — `applyFastAutofocus`
- Add an early `if (isIOS) return;` guard at the top, so any other caller (e.g. `enableBestCamera` at line 511) also skips it on iOS.
- Leave Android/desktop path untouched — Chrome handles `advanced` modes gracefully and we want the sharpness/contrast/macro tuning there.

### 4. Tap-to-focus (`handleVideoTap`)
- Keep as-is. It only fires on user tap, not during the first 3s, so it's not part of this regression. (If iOS still drops on tap later, we'll address separately.)

## Why this is safe
- iPhone rear cameras default to continuous AF + AE + AWB without any constraint calls, so capture quality on the iPhone 17 Pro path is unchanged.
- The previously-shipped `display-p3` canvas color fix and iPhone-17 capture quality (0.98) are untouched.
- Android, desktop Chrome, and older iPhones still get the full `applyFastAutofocus` tuning.

## Validation
1. Open `/scan` on the iPhone 17 Pro — preview should stay live indefinitely, no "Camera dropped" status.
2. Console should show `[Camera] getUserMedia ok …` and `[Camera] started 1920×1080 @ 30fps` and **no `[Camera] active track ended unexpectedly`** message.
3. Capture a card — preview must remain live after capture.
4. On desktop Chrome and an Android device, hardware tuning logs (`Macro focus enabled`, `Sharpness set to max`, etc.) should still appear.

## Out of scope
4K capture path, OCR routing, queue behavior, capture compression, color-space fix.
