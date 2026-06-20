# Rapid Scan Viewfinder Center Fix

Fixed the rapid-scan alignment box so it centers over the actual visible camera image, not the full letterboxed video element.

## Changed

- `src/components/scanner/RapidScanCamera.tsx`
- `components/scanner/RapidScanCamera.tsx`

## Details

- Added live viewfinder metric calculation from `video.clientWidth/clientHeight` and `video.videoWidth/videoHeight`.
- Matched the same rectangle created by CSS `object-contain`.
- Moved the guide frame into that visible rectangle.
- Sized the guide so it stays inside the live camera image on desktop, mobile portrait, and mobile landscape.
- Added resize/orientation/metadata listeners so the guide recenters when the camera feed loads or screen orientation changes.
- Changed the video element to `block` to remove inline video baseline drift.

## Validation

`npm run build` could not run in this package copy because `node_modules` is not included and `vite` is unavailable in the sandbox. Run this locally after installing dependencies:

```bash
npm install
npm run build
```
