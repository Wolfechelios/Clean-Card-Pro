# Fix: iPhone 17 Pro Rapid Scan preview dies after ~2-3s

## Diagnosis (confirmed)

- No Apple driver/certificate is involved. All iOS browsers (Safari, Chrome, Firefox) use WebKit. Switching browsers cannot fix this.
- Native iOS Camera works fine → hardware, thermal, and permissions are healthy.
- Console shows `started 1080×1920 @ 30fps` then `Macro focus enabled… ISO set to minimum: 100 … Color temperature: 5500K` immediately before the track dies.
- iOS 26 WebKit on the iPhone 17 Pro sensor drops the track when **manual ISO + manual white balance + manual focus distance** are forced together right after stream start. Our `applyFastAutofocus()` does exactly that.

## Goal

Keep the preview alive on iPhone 17 Pro / iOS 26 without regressing Android or desktop image quality.

## Changes

Scope is limited to camera constraint application. No UI, queue, OCR, or pricing changes.

### 1. `src/lib/camera-optimizations.ts` — soften iOS hardware tuning

Add an `isIOS` check at the top of `applyFastAutofocus()` using existing `platform.ts` / UA sniff.

On iOS:
- **Skip** `focusDistance` override (don't force macro distance — let `focusMode: continuous` handle it).
- **Skip** manual `iso` override.
- **Skip** manual `colorTemperature` + `whiteBalanceMode: 'manual'` block entirely.
- **Skip** `sharpness`, `contrast`, `saturation` overrides (WebKit silently rejects most of these and the rejection cascade can end the track).
- **Keep** only the safe continuous-mode hints: `focusMode: continuous`, `exposureMode: continuous`, `whiteBalanceMode: continuous`, and a small `exposureCompensation: +0.3` if supported.

Non-iOS keeps the full optimization stack unchanged.

### 2. `src/lib/camera-optimizations.ts` — cap iOS resolution ladder

In `getMaxCameraConstraints()`, when `isIOS`:
- Remove the 8K and 4K rungs from the array (they negotiate down anyway and the negotiation itself can stall WebKit on iOS 26).
- Start the ladder at **1920×1440** (4:3) → 1920×1080 → 1280×720 → fallback.
- Drop the `resizeMode: 'none'` advanced hint on iOS (WebKit treats unknown advanced keys inconsistently).

### 3. `src/components/scanner/RapidScanCamera.tsx` — defer the hardware tuning call

`applyFastAutofocus()` is currently called inside `getMaxQualityStream()` synchronously after stream open. On iOS, wrap that single call in a `setTimeout(..., 1200)` so the track has time to stabilize before any `applyConstraints` is issued. Non-iOS calls it immediately as today.

The 1500ms RAF warm-up and 800ms capability-probe deferral from the previous round stay in place.

### 4. Status messaging

If the track still ends after these changes, the existing `ended` handler already surfaces "Camera dropped — tap Start to retry." No change there. Do not re-introduce silent auto-restart (that caused the permission prompt loop last round).

## Out of scope

- Capacitor / native iOS build path
- Capture quality pipeline (anti-glare, OCR enhance, color balance on the captured Blob)
- Any other scanner screen (Microscope, Graded, Mobile, Remote, USB)
- Backend, queue, pricing

## Validation

1. Open `/scan` on iPhone 17 Pro in Chrome and in Safari → preview must stay live indefinitely.
2. Capture a card → image still enqueues, preview stays live after capture.
3. Open `/scan` on Android Chrome and desktop Chrome → resolution and quality unchanged from today.
4. Console on iPhone should show `started …` and **no** `Macro focus enabled`, **no** `ISO set to minimum`, **no** `Color temperature: 5500K` lines.

## Technical notes

- `platform.ts` already exports `isIOS()` — reuse it (UA fallback for web context where Capacitor isn't native).
- The "iPhone 17 class" detector in `src/lib/deviceClass.ts` is stricter (iOS 26 + DPR ≥3 + cores ≥6). For this fix use the broader `isIOS()` — the manual-hardware issue affects all iOS 17+ devices, not just the 17 Pro.
- No new dependencies. No schema changes. No edge function changes.
