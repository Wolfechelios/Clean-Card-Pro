## Binder Page Photo Capture → Auto-Crop into 9 Cards → Reuse Rapid Scanner Pipeline

You photograph a 9-pocket binder page, the app perspective-corrects and slices it into 9 individual card images, and each crop is pushed into the **same scan queue the Rapid Scanner already uses** (`idbAdd` → `queueProcessor` → `rapid-card-identify`). No new identification logic is built — binder capture is purely a "best photo + best crop" front-end that feeds the existing pipeline.

### What gets built

#### 1. Best-possible photo capture (`BinderPageCapture.tsx`)

Reuses the proven camera setup from `RapidScanCamera.tsx`:

- Rear camera enforced (per existing optic-selection rules)
- 4:3 aspect ratio, requests max resolution the device offers (per existing `camera-optimizations.ts`)
- Continuous autofocus + auto white-balance, then **focus lock** on tap so the page doesn't refocus mid-shot
- Torch toggle (on by default in dim conditions, detected from a quick exposure read)
- Live overlay: 3×3 grid guide + corner targets so the user aligns the binder page edges to the frame
- "Hold steady" indicator: pre-capture motion check using `devicemotion` / frame-diff; capture button disables until the device is still
- Multi-frame capture: takes 3 rapid frames and picks the **sharpest** one (variance-of-Laplacian on a downsampled grayscale canvas — same metric the microscope path already uses)
- Saves the chosen frame at full resolution as a JPEG ~92% quality

#### 2. Best-possible crop (`pageDetect.ts` + `gridSlicer.ts`)

- **Auto page detection**: Canvas-based edge detection (Sobel) → contour walk → largest 4-corner quad. Pure JS, no native deps.
- **Perspective warp**: 4-point homography on a `<canvas>` flattens the page to a true rectangle at the standard 9-pocket aspect ratio.
- **Grid slicing**: divide the warped rectangle into the configured grid (default 3×3, also supports 4×3 / 3×4 horizontal binders) with an inner pocket-padding %, so each cell is card art only — no plastic seam.
- **Per-cell tightening**: each cell gets a final auto-crop using a brightness/edge threshold to trim residual pocket plastic, then is exported at the standard card aspect (2.5:3.5).
- **Confidence score** per cell. Low confidence on any cell → the cell is flagged in the preview for manual adjust.
- **Manual override panel**: 4 draggable corners on the page, an inner-padding slider, and rows/cols selector. Re-slices live as you drag.

#### 3. Hand-off to the existing Rapid Scanner pipeline

The 9 (or fewer, if user marks empty pockets) crops are pushed straight into the existing queue — no new identification code:

```text
crop blob
  -> idbAdd({ type: 'rapid', image, source: 'binder-capture',
              binderSlot: { setId, row, col } })
  -> queueProcessor (existing single-worker, rate-limit aware)
  -> rapid-card-identify edge function (existing)
  -> existing dedupe + duplicate-card detection
  -> existing officialNameResolver + pricing
  -> card written to `cards` table via existing dual-write pattern
```

A small addition in `queueProcessor` (or its result handler): when a queue item carries `source === 'binder-capture'` with a `binderSlot`, on success the resolved card is also tagged with that slot's `setId` / position so the binder grid auto-fills the right pocket. No schema change — uses existing `card_set` / `card_number` matching that the binder grid already does in `use-binder-data.ts`.

#### 4. Preview screen before sending to the queue

After auto-crop, user sees a 3×3 preview of the 9 cell images with per-cell actions:
- **Re-shoot whole page**
- **Adjust grid** (open manual corner/padding panel)
- **Skip this pocket** (empty sleeve)
- **Rotate this cell 90°** (sideways cards)
- **Confirm all** → enqueue 9 items

#### 5. Picture display settings (small companion change to the sidebar)

Since the original ask was also "binder mode settings for pictures," add a **Pictures** section in `BinderControls.tsx` so the captured images render cleanly:

- Image Display: `Full image` / `Thumbnail (fast)` / `Hide images`
- Image Fit: `Cover` / `Contain` (Contain matters for full-art that shouldn't be cropped)
- Card Size: `Compact` / `Standard` / `Large`
- Missing Card Style: `Empty slot` / `Card silhouette` / `Set logo`
- Foil Glow: switch
- Show Card Name: switch

Persisted in `localStorage` via a new `use-binder-settings.ts` hook.

### Files

**New**
- `src/components/binder/BinderPageCapture.tsx` — camera + multi-frame sharpness + auto-crop preview + manual override + enqueue
- `src/lib/binder/pageDetect.ts` — Sobel edge detect + 4-corner quad finder + 4-point homography warp
- `src/lib/binder/gridSlicer.ts` — grid slicing, per-cell tighten, per-cell rotate
- `src/lib/binder/sharpness.ts` — variance-of-Laplacian helper for picking the best frame
- `src/hooks/use-binder-settings.ts` — localStorage settings hook

**Edited**
- `src/components/binder/BinderGrid.tsx` — "Capture Binder Page" button + apply card-size CSS var
- `src/components/binder/BinderControls.tsx` — add Pictures section
- `src/components/binder/BinderSlotCard.tsx` — honor image-mode/fit/foil/name/missing-style props
- `src/pages/BinderPage.tsx` — wire settings + capture dialog state
- `src/lib/queueProcessor.ts` — recognize `source: 'binder-capture'` items and stamp the resolved card with the binder slot context (small additive change)

### Confirmations

- **Identification logic**: unchanged. Reuses `rapid-card-identify`, queue, dedupe, pricing, dual-write. No new edge function.
- **Storage**: crops are uploaded by the existing pipeline to the existing `card-images` bucket — same path used by Rapid Scanner today.
- **No DB schema changes.**
- **Rate-limit / 429 backoff**: inherited automatically because we go through `queueProcessor`.

### Verification

- Open `/binder` → "Capture Binder Page" button visible at top of grid; sidebar shows new Pictures section
- Tap Capture → camera opens with rear lens, 3×3 alignment overlay, capture button disabled until steady
- Photograph a real 9-pocket page → preview shows 9 perspective-corrected card crops
- Drag a corner handle → grid re-slices live
- Mark one pocket as Skip, rotate one sideways card 90°, Confirm
- 8 items appear in the existing scan queue; queue indicator counts up; identifications complete using the same flow as Rapid Scanner
- Identified cards appear in their correct binder pockets automatically

### Out of scope (later)

- Multi-page batch (capture page after page back-to-back)
- OCR-driven slot assignment when set isn't pre-selected
