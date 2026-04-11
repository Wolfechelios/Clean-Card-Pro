

## Plan: Add Shutter Sound to All Camera Capture Paths

### Problem
`playShutterBeep()` is only called in `RapidScanCamera.tsx`. Two other capture paths are silent:
- `MobileCameraScanner.tsx` → `capturePhoto()` and `captureNativePhoto()`
- `use-camera-capture.ts` → `capturePhoto()`

### Changes

| File | Change |
|------|--------|
| `src/components/scanner/MobileCameraScanner.tsx` | Import `playShutterBeep` from `audioBeeps`; call it at the top of `capturePhoto()` (line ~290) and `captureNativePhoto()` |
| `src/hooks/use-camera-capture.ts` | Import `playShutterBeep` from `audioBeeps`; call it at the start of `capturePhoto()` (line ~158) before focus/capture logic |

Both calls are fire-and-forget (synchronous, already has internal try/catch). Two lines per file.

