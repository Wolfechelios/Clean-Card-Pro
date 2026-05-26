## Goal
Stop the Rapid Scan camera preview from dying ~2-3s after start on iPhone 17 Pro.

## Why it's still breaking
The iOS `applyConstraints` flood is already gated, so that's not it anymore. Two remaining causes in `RapidScanCamera.tsx`:

1. The instant `cameraOn` flips true, **two requestAnimationFrame loops** start reading frames out of the live 1080p video:
   - Auto-capture sampler (`drawImage` + `getImageData` ~8x/sec)
   - Foil-detection sampler (`drawImage` + `analyze` every 500ms)
   On iOS 26 WebKit, hammering the freshly started camera track with concurrent canvas readbacks during its first ~1-2s warm-up can cause WebKit to terminate the track.
2. The `track.addEventListener("ended", …)` handler unconditionally calls `setCameraOn(false)` and shows "Camera dropped — tap Start to retry". On iOS the track can fire a transient `ended` during early lifecycle without the user doing anything wrong — and we never recover.

## Changes (scope: `src/components/scanner/RapidScanCamera.tsx` only)

### 1. Delay heavy sampling on iOS
In both the auto-capture `useEffect` (around line 219) and the foil-detection `useEffect` (around line 285), add a 1500ms warm-up delay before kicking off the RAF loop **when running on iOS**. Non-iOS keeps current behavior.

Implementation: wrap the existing `raf = requestAnimationFrame(tick)` start in a `setTimeout(..., isIOS ? 1500 : 0)`, and clean up the timeout in the effect's cleanup.

### 2. Auto-recover from spurious `ended` on iOS
In `startCamera` (around line 611) where the `ended` handler is registered:
- On iOS, do NOT immediately set `cameraOn = false`. Instead, attempt one silent restart: call `startCamera()` again. Only if the second attempt also dies within 3s do we surface the "Camera dropped" status.
- Track this with a small `iosRestartAttemptedRef` ref that resets when the user explicitly stops the camera or successfully captures.
- Non-iOS keeps the current explicit fail-fast behavior so we don't mask real errors on desktop/Android.

### 3. (Defensive) Skip `clarityZoom.reset()` and `detectZoomCapabilities()` until after the iOS warm-up
Move both calls inside a `setTimeout(..., isIOS ? 800 : 0)` so the very first frames aren't competing with capability probes. These don't call `applyConstraints` but `getCapabilities()` on iOS during warm-up has been observed to occasionally stall the pipeline.

## Out of scope
- Native (Capacitor) camera path
- Capture quality, color-space, queue, OCR, pricing
- Other scanner screens (Mobile Scan, Graded Scan)
- Any backend or DB change

## Validation steps
1. Open `/scan` on the iPhone 17 Pro.
2. Preview must stay live indefinitely (>30s of idle observation).
3. Tap Capture — image should still enqueue and preview should stay live afterward.
4. On desktop Chrome and an Android phone, behavior must be unchanged (auto-capture and foil detection still kick in immediately).
5. If preview ever dies, status line should briefly show recovery (one silent restart) before falling back to the existing error message.
