# Add Camo to camera choices

Camo (the Reincubate iPhone-as-webcam app) is already detected as a USB device by `src/hooks/use-camera-devices.tsx` (line 89), so it shows up in the camera dropdown — but it appears with its raw OS label (e.g. "Reincubate Camo") and a generic USB icon, which makes it easy to miss. This plan promotes Camo (and the other common phone-as-webcam apps) to a first-class, clearly labeled choice.

## What changes

1. Give Camo a dedicated lens type + friendly label so it's instantly recognizable in the dropdown.
2. Apply the same treatment to the other phone-as-camera apps already detected (Continuity Camera, EpocCam, DroidCam, Iriun) so the list reads consistently.
3. Add a matching icon in the selector.
4. Make sure refreshing the device list picks up Camo as soon as it's connected (it already does, via the `devicechange` listener — just verifying behavior).

## User-visible result

The camera dropdown will show entries like:

```
[icon] Camo (iPhone)
[icon] Continuity Camera
[icon] EpocCam
[icon] Wide (Main)
[icon] Ultra Wide
```

instead of raw OS strings buried among other USB devices.

## Technical details

**`src/hooks/use-camera-devices.tsx`**
- Extend `LensType` with `"camo" | "continuity" | "epoccam" | "droidcam" | "iriun"` (keeping `"usb"` as the generic fallback).
- Add a `classifyPhoneCam(label)` helper that runs before the generic USB branch and returns a friendly `lensLabel` (e.g. `"Camo (iPhone)"`, `"Continuity Camera"`).
- In the `videoInputs.map` block, when `usb` is true, call `classifyPhoneCam` first; fall back to the existing label if no specific app matches.
- Auto-select preference unchanged (still prefers rear "wide"); Camo remains user-selectable.

**`src/components/scanner/CameraDeviceSelector.tsx`**
- Extend `getLensIcon` to return a distinct icon for `camo` / `continuity` / `epoccam` / `droidcam` / `iriun` (e.g. `Smartphone` for phone-based, keeping `Webcam`-style for generic USB). Uses existing `lucide-react` icons — no new deps.

**No changes needed** to `MobileCameraScanner`, `ContinuityCameraIngest`, or scan pipeline — they consume `deviceId` only.

## Out of scope

- Auto-switching to Camo when it appears (user still picks it from the dropdown).
- Installing/configuring Camo itself — that's a user-side setup; the existing USBPhoneCameraScanner help text already mentions it.
