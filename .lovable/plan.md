

## Diagnosis

### 1. Queue Window Still Popping Up
The `QueueStatusIndicator` component is already disabled (returns `null`) and removed from `App.tsx`. However, the **"Buffer status" panel** at the bottom of `RapidScanCamera.tsx` (lines 1667-1672) is always visible inside the rapid scanner. Additionally, **Sonner toast notifications** fire on many queue events (buffer full, mode changes, capture success/failure). These toasts are likely the "queue window" you're seeing — they stack up during rapid scanning and obscure the viewfinder.

### 2. Front-Facing Camera Still Showing
The `useCameraDevices` hook probes each camera via `probeDeviceFacingMode()`, but on many Android devices (especially gaming phones like Red Magic), the probe returns `"unknown"` for both front and back cameras because:
- `track.getSettings().facingMode` is empty
- `track.getCapabilities().facingMode` returns both `["user", "environment"]` (treated as ambiguous → returns `"unknown"`)
- Label-based detection (`getFacingFromLabel`) only works if the label contains "front"/"back" etc.

When facing mode is `"unknown"` and `shouldAllowUnknownAsRear` is `true` (the default), ALL cameras including front pass through. The regex filter in `RapidScanCamera.tsx` (line 149) only catches labels with explicit "front/facetime/selfie/user" text — which many Android devices don't include.

## Plan

### Fix 1: Suppress toast notifications during active rapid scanning
- In `RapidScanCamera.tsx`, suppress non-critical toasts while the camera is active (mode change toasts, "Camera ready" toasts, etc.)
- Remove or hide the "Buffer status" panel at the bottom (lines 1667-1672) since it's redundant with the inline badge

### Fix 2: Harden front camera exclusion with resolution-based probing
- In `probeDeviceFacingMode()`, when facing mode is ambiguous (`"unknown"`), add a **resolution check**: open a temporary stream at the device's max resolution. Front cameras typically max out at much lower resolution than rear cameras.
- Add a heuristic: if a device has 2+ cameras with `"unknown"` facing and one has significantly lower max resolution, classify it as `"user"` (front).
- As a fallback, when `useCameraDevices` finds multiple unknown-facing cameras, only include the one(s) with the highest max resolution (rear cameras are almost always higher res).

### Fix 3: Remove the "Buffer status" box entirely
- Delete the "Buffer status" `div` (lines 1667-1672) from `RapidScanCamera.tsx` — the buffer count is already shown in the inline badge on desktop

### Files to modify
- `src/hooks/use-camera-devices.tsx` — enhance `probeDeviceFacingMode` with resolution-based front/rear discrimination
- `src/components/scanner/RapidScanCamera.tsx` — remove Buffer status panel, reduce toast spam during active scanning

