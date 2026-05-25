## Goal

Make Rapid Scan on iPhone 17 Pro as fast and accurate as the hardware allows by (1) requesting better camera constraints, (2) capturing at native sensor resolution with sharper compression, (3) locking exposure/white-balance during a scan burst, and (4) routing OCR through the highest-fidelity path with iOS-aware preprocessing. No business-logic or schema changes.

## Detection

Add an `isIPhone17Class()` helper (UA + `iOS >= 26` + `devicePixelRatio >= 3` + `hardwareConcurrency >= 6`) reused across camera and OCR code so tuning stays consistent.

## 1. Camera constraints (`RapidScanCamera.tsx` `startCamera`)

Today: `width:1920, height:1080, facingMode:environment`. Upgrade to:

- `width: { ideal: 3840 }`, `height: { ideal: 2160 }` (4K back camera; iPhone 17 Pro main + tele both support it; Safari downshifts cleanly).
- `frameRate: { ideal: 30, max: 60 }` so AF converges faster.
- `aspectRatio: { ideal: 16/9 }` to avoid letterboxed sensor crop.
- `advanced: [{ focusMode: "continuous" }, { exposureMode: "continuous" }, { whiteBalanceMode: "continuous" }]` requested upfront.
- After first successful frame on iPhone 17 class: `applyConstraints` to lock exposure + WB (`exposureMode:"manual"`/`continuous` per setting) so consecutive snaps in a burst keep identical color/brightness — big OCR win.
- Prefer the rear *wide* (not ultra-wide) by filtering `enumerateDevices` for the device whose `label` contains "back" and *not* "ultra"/"telephoto" when no `selectedDeviceId` is set.

## 2. Capture quality (`captureCard`)

- Bump `c.toBlob(..., "image/jpeg", 0.95)` → `0.98` for iPhone 17 class (sensor noise is low, OCR benefits).
- Skip the in-canvas `applyAutoColorBalance` / `applyAntiGlare` passes on iPhone 17 class — iOS ISP already does this and the JS pass softens edges. Gate behind tier flag.
- Use `createImageBitmap(video, { imageOrientation:"from-image", resizeQuality:"high" })` then draw to canvas to avoid the implicit chroma subsampling Safari applies on `drawImage(video,…)`.
- Pass through native pixel size (`videoWidth/Height`) — already done; just stop clamping to 1920×1080.

## 3. Device-tier tuning (`lib/performance/deviceTier.ts`)

- For iPhone 17 class, override `captureQuality` to `0.98` and reduce `bulkApiDelayMs` to `10` (current high tier is 20). Increases throughput during burst-scan.
- Cache result and log once.

## 4. Compression for queue (`compressImageForQueue`)

- Today compresses uniformly. On iPhone 17 class, keep long edge at 2400 px (vs current ~1600) and quality 0.92. This is what's sent to OCR — the single biggest accuracy lever.

## 5. OCR pipeline (`supabase/functions/rapid-card-identify` + `zai-ocr`)

- Accept an optional `clientHint: { device:"iphone17pro", pixelW, pixelH, capturedAt }` header/body field (validated with zod) and log it for analytics.
- When `pixelW >= 2400`, skip the server-side downscale step (currently downsizes to ~1280 before Gemini Vision) and forward the full image to Gemini 2.5 Pro Vision; fall back to Flash for smaller frames. Bigger inputs measurably improve set-code/card-number OCR.
- Set `temperature: 0.05` and `responseModalities:["TEXT"]` for deterministic extraction.

## 6. Focus + tap behavior

- On iPhone 17 class, replace the periodic "tap to focus → manual" toggle with a single `pointsOfInterest` constraint at tap location followed by a 350 ms refocus, then re-enter continuous. Faster than current double-apply.

## 7. Validation

After build:
- Open `/scan` on iPhone 17 Pro preview, confirm console logs `[DeviceTier] high (iphone17)` and `videoWidth >= 3024`.
- Capture 5 cards back-to-back; verify EXIF/blob size > 600 KB and OCR returns set+number on ≥4/5.
- Bulk-scan 9-pocket sheet, ensure no frame drops vs baseline (compare `RapidScan/perf` console marks).

## Files to touch

- `src/lib/performance/deviceTier.ts` — add iPhone17 override + helper export.
- `src/components/scanner/RapidScanCamera.tsx` — `startCamera`, `captureCard`, tap-to-focus block.
- `src/hooks/use-camera-devices.tsx` — rear-wide preference helper (read-only addition).
- `src/lib/imaging/compressImageForQueue.ts` (or wherever it lives) — iPhone17 branch.
- `supabase/functions/rapid-card-identify/index.ts` — accept clientHint, skip downscale, route to Pro Vision.
- `supabase/functions/zai-ocr/index.ts` — mirror clientHint passthrough.

## Out of scope

- Pricing logic, schema, RLS, UI redesign, native (Capacitor) camera path.
