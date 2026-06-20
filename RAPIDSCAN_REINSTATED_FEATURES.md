# Rapid Scan Feature Reinstatement

This pass keeps the reset rapid scanner simple, but reinstates the practical camera controls that are needed for fast physical card scanning.

## Reinstated

- Auto timer capture
  - Timer button starts/stops repeated capture.
  - Interval button cycles 1s, 2s, 3s, 5s.
  - Timer stops automatically when camera stops or queue anomaly pause triggers.

- Autofocus
  - Continuous autofocus is requested when the camera starts.
  - Tap-to-focus is active on the video preview.
  - A short focus marker appears where the user taps.
  - Unsupported browsers/cameras fail safely without breaking scan.

- Zoom
  - Zoom slider, zoom in/out buttons, reset button.
  - Pinch-to-zoom on touch devices.
  - Uses browser/camera optical zoom when supported by MediaTrackCapabilities.
  - Falls back to digital crop zoom when optical zoom is not exposed.
  - Captured image matches digital zoom crop instead of only visually scaling preview.

## iPhone / Continuity Camera cleanup meaning

The scanner now favors standard browser camera APIs instead of third-party camera-app assumptions. It uses:

- `enumerateDevices()` to list video inputs.
- `getUserMedia()` with selected device ID when a camera is chosen.
- `facingMode: environment` as the fallback for phone/rear camera behavior.
- Direct camera capability detection for torch, focus, and zoom.

The device detector no longer treats Camo as a preferred/expected phone camera path.
