# iPhone Pro Capture Pass

Implemented a hardware-aware capture layer for Clean Card Pro while preserving the existing Rapid Scan / queue processor architecture.

## Added

- `src/lib/iphoneProCapture.ts`
  - Capture profiles: Rapid Stack, Single Card Pro, Binder 9-Pocket, Foil / Holo Pass, Macro Text Lock, Slab / Graded, Verify / Price Check.
  - Camera constraint generator for high-detail iPhone/Pro mobile capture.
  - Local capture quality analyzer for focus, exposure, glare, framing, detail, and overall confidence.
  - Optional capture metadata helpers for queue records.

- `src/components/scanner/IPhoneProCapturePanel.tsx`
  - Profile selector.
  - Pro capture enable/disable switch.
  - Quality gate controls.
  - Last-capture quality breakdown.
  - Quick presets for stacks, binder pages, foil, and tiny text.

- `src/pages/IPhoneProScanPage.tsx`
  - New `/iphone-pro` workflow page.
  - Scanner setup overview, active profile summary, shortcut guidance, and profile picker.

## Wired into existing app

- `src/App.tsx`
  - Added lazy route for `/iphone-pro`.

- `src/lib/navigation.ts`
  - Added sidebar navigation item: **iPhone Pro**.

- `src/hooks/use-scanner-settings.ts`
  - Added persistent Pro capture settings:
    - `proCaptureEnabled`
    - `proCaptureMode`
    - `proCaptureQualityGate`
    - `proCaptureMinConfidence`

- `src/components/scanner/RapidScanCamera.tsx`
  - Uses Pro capture camera constraints when enabled.
  - Shows compact Pro capture panel above the live viewfinder.
  - Adds binder grid, macro text guide, slab label guide, and normal card guide.
  - Scores captures locally before adding to the queue.
  - Stores capture mode, profile, confidence, quality flags, and source metadata in the IndexedDB queue.
  - Warns on low confidence without blocking fast stack scanning.

- `src/components/scanner/MobileCameraScanner.tsx`
  - Uses Pro capture constraints on mobile web.
  - Scores native/mobile captures before upload.
  - Shows compact Pro capture panel in native and web mobile camera screens.

- `src/lib/idbQueue.ts`
  - Queue metadata now accepts optional Pro capture fields while remaining backward-compatible.

- `src/components/scanner/ScannedCardList.tsx`
  - Shows capture mode and confidence badges on completed scanned card rows when metadata is available.

## Validation performed

- Dependency install required `--legacy-peer-deps` because the repo already has an ESLint 10 / react-hooks peer dependency conflict.
- Targeted ESBuild checks passed for:
  - `src/lib/iphoneProCapture.ts`
  - `src/components/scanner/IPhoneProCapturePanel.tsx`
  - `src/pages/IPhoneProScanPage.tsx`
  - `src/components/scanner/RapidScanCamera.tsx`
  - `src/components/scanner/MobileCameraScanner.tsx`
- Full Vite production build was attempted twice. It did not throw a source-code error, but timed out while transforming the existing heavy OpenCV/OCR/ONNX dependency graph.

## Suggested next native pass

For a real App Store / Capacitor iOS build, expose these profiles to native Swift capture controls so Camera Control / Action Button shortcuts can open directly into mode-specific capture flows.
