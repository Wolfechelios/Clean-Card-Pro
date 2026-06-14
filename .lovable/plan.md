## Problem

On iPhone Chrome at `/scan`, the camera picker shows only "external camera (iPhone)" instead of the phone's actual Wide / Ultra Wide / Telephoto lenses.

## Root cause

`src/hooks/use-camera-devices.tsx` was written to detect phone-as-webcam apps (external camera, Continuity, EpocCam…) running on a **desktop**. The matchers treat any device label containing `iphone`, `ipad`, or `ios` as a virtual phone camera:

- `isUSBDevice()` returns `true` for labels containing `"iphone"` / `"ipad"`.
- `classifyPhoneCam()` then labels them `external camera (iPhone)` / `external camera (iPad)`.

When the page is actually opened **on an iPhone**, iOS/Chrome exposes the rear cameras with labels like `"Back Camera"`, `"Back Dual Wide Camera"`, and on some builds strings that include `"iPhone"`. Every device ends up routed through the external camera branch, so the real lenses disappear from the dropdown.

There is already an `isIOSWebKitLike()` helper in the same file — it just isn't consulted before applying the desktop-only phone-cam matchers.

## Fix

Edit only `src/hooks/use-camera-devices.tsx`:

1. Compute `isIOS = isIOSWebKitLike()` once at the top of `refreshDevices` (already done) and pass it into the per-device classification.
2. When `isIOS` is true:
   - Skip `classifyPhoneCam()` entirely (external camera / Continuity / EpocCam / DroidCam / Iriun cannot run as virtual cameras on iOS Safari/Chrome anyway).
   - Tighten `isUSBDevice()` so `"iphone"`, `"ipad"`, `"ios"`, `"continuity"`, `"desk view"`, `"external-camera"`, `"reincubate"` do NOT force the USB branch on iOS. The device should fall through to `isRearCamera()` + `classifyLens()` and be labeled Wide / Ultra Wide / Telephoto using the existing positional heuristic.
3. Leave desktop behavior unchanged — external camera / Continuity / EpocCam still classify correctly on macOS/Windows.

No changes to `RapidScanCamera.tsx`, `CameraDeviceSelector.tsx`, or anything else. iOS will continue using `facingMode: environment` (already enforced via the empty `selectedDeviceId` on iOS), but the picker will now correctly list the rear lenses instead of a phantom "external camera" entry.

## Verification

- Reload `/scan` on iPhone Chrome → dropdown shows real rear lenses (e.g. "Wide (Main)", "Ultra Wide", "Telephoto"), no "external camera" entry.
- Desktop with external camera software running → still shows "external camera (iPad)" / "external camera (iPhone)" as before.
