## Problem

Digital zoom blurs the live preview because the video stream is captured at ~1080p (or lower) and CSS `scale()` stretches those pixels across a higher-DPR display. The previous capture-side crop change didn't help and degraded the saved image — revert it.

## Plan

### 1. Revert the capture-side center-crop
In `src/components/scanner/RapidScanCamera.tsx`, restore the original full-frame capture (draw the whole video at native resolution). The crop hurt downstream identification.

### 2. Request a higher-resolution stream so digital zoom has pixels to spare
In the camera open path (`getUserMedia` constraints inside `RapidScanCamera`), bump the ideal/max resolution for the rear camera to 3840×2160 (with progressive fallback to 2560×1440 → 1920×1080 → device default). More native pixels means a 2–3× CSS scale stays sharp instead of pixelating.

Keep the existing progressive-fallback ladder from the camera-fallback memory; just add the 4K/QHD tiers above the current top.

### 3. Re-probe for hardware zoom after each stream upgrade
When the higher-res stream resolves, re-run `detectZoomCapabilities()` so devices that expose hardware zoom on the back camera (most modern iPhones, Pixels, Galaxies) use it instead of digital scale.

### 4. Sharpen the digital-zoom preview itself
On the `<video>` element, when `usingDigitalZoom && zoomLevel > 1`:
- add CSS `image-rendering: high-quality` (Safari/Chrome accept `-webkit-optimize-contrast` as a fallback)
- add `transform-origin: center center` and `will-change: transform` so the browser uses GPU-accelerated bilinear scaling instead of nearest-neighbor in some engines
- keep `transform: scale(z)` but wrap in `translateZ(0)` to force a compositor layer

No layout or component changes outside the video element.

### 5. Don't touch capture quality
Capture continues to use the full native video frame at full resolution — same JPEG quality settings (0.95 / 0.98 on iPhone 17), same `compressImageForQueue` cap. The saved card image will match or exceed what was there before my last change.

## Files touched
- `src/components/scanner/RapidScanCamera.tsx` — revert capture crop, raise stream resolution ladder, re-probe zoom, tweak video element CSS for digital zoom.

## Validation
- Open `/scan`, pinch to 2× and 3×: preview noticeably sharper than today.
- Snap a card at 1× and at 2.5×: saved thumbnail is at least as sharp as before today's earlier change.
- On a device with hardware zoom, confirm `usingDigitalZoom` flips to false and the lens physically zooms.
- No regressions to capture pipeline, queue, or identification.
