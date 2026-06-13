## Problem

On iPhone Chrome at `/scan`, the camera picker shows only "Camo (iPhone)" instead of the phone's actual Wide / Ultra Wide / Telephoto lenses.

## Root cause

`src/hooks/use-camera-devices.tsx` was written to detect phone-as-webcam apps (Camo, Continuity, EpocCam…) running on a **desktop**. The matchers treat any device label containing `iphone`, `ipad`, or `ios` as a virtual phone camera:

- `isUSBDevice()` returns `true` for labels containing `"iphone"` / `"ipad"`.
- `classifyPhoneCam()` then labels them `Camo (iPhone)` / `Camo (iPad)`.

When the page is actually opened **on an iPhone**, iOS/Chrome exposes the rear cameras with labels like `"Back Camera"`, `"Back Dual Wide Camera"`, and on some builds strings that include `"iPhone"`. Every device ends up routed through the Camo branch, so the real lenses disappear from the dropdown.

There is already an `isIOSWebKitLike()` helper in the same file — it just isn't consulted before applying the desktop-only phone-cam matchers.

## Fix

Edit only `src/hooks/use-camera-devices.tsx`:

1. Compute `isIOS = isIOSWebKitLike()` once at the top of `refreshDevices` (already done) and pass it into the per-device classification.
2. When `isIOS` is true:
   - Skip `classifyPhoneCam()` entirely (Camo / Continuity / EpocCam / DroidCam / Iriun cannot run as virtual cameras on iOS Safari/Chrome anyway).
   - Tighten `isUSBDevice()` so `"iphone"`, `"ipad"`, `"ios"`, `"continuity"`, `"desk view"`, `"camo"`, `"reincubate"` do NOT force the USB branch on iOS. The device should fall through to `isRearCamera()` + `classifyLens()` and be labeled Wide / Ultra Wide / Telephoto using the existing positional heuristic.
3. Leave desktop behavior unchanged — Camo / Continuity / EpocCam still classify correctly on macOS/Windows.

No changes to `RapidScanCamera.tsx`, `CameraDeviceSelector.tsx`, or anything else. iOS will continue using `facingMode: environment` (already enforced via the empty `selectedDeviceId` on iOS), but the picker will now correctly list the rear lenses instead of a phantom "Camo" entry.

## Verification

- Reload `/scan` on iPhone Chrome → dropdown shows real rear lenses (e.g. "Wide (Main)", "Ultra Wide", "Telephoto"), no "Camo" entry.
- Desktop with Camo Studio running → still shows "Camo (iPad)" / "Camo (iPhone)" as before.
