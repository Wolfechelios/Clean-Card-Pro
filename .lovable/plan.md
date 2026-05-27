## Problem

The phone-to-computer remote scan pipeline transfers images at conservative quality. Capture maxes at 1080p, JPEG quality tops out at 0.92 (`high`), and burst floors at 250 ms. End result: lower effective bitrate than the network and storage can handle.

## Plan

Edit `src/components/scanner/RemoteScanMobile.tsx` only — no business logic changes, just capture quality knobs.

### 1. Raise capture resolution ladder
In `startCamera`, replace the single 1920×1080 constraint with a progressive ladder: try 3840×2160 → 2560×1440 → 1920×1080 → device default. Mirror the pattern already used in `RapidScanCamera`. More native pixels per frame = higher effective bitrate per photo.

### 2. Raise JPEG quality tiers
In `captureFrame`, update `qualityMap` from `{ low: 0.6, medium: 0.78, high: 0.92 }` to `{ low: 0.75, medium: 0.88, high: 0.96 }`. `high` becomes near-visually-lossless.

### 3. Shorten burst floor
In `startBurst`, lower the minimum delay from `Math.max(250, ...)` to `Math.max(120, ...)` so the phone can push frames roughly twice as fast when the user sets a short interval.

### 4. Add a `cacheControl` bump
Keep `cacheControl: '3600'` — no change needed. Storage upload is already direct binary; nothing else to widen there.

### Out of scope
- Desktop side (`RemoteScanDesktop.tsx`) — it just receives URLs, no bitrate knob.
- Supabase Realtime broadcast — only carries the URL string, not the image bytes.
- Settings UI defaults in `use-scanner-settings.ts` — left alone unless requested.

## Files touched
- `src/components/scanner/RemoteScanMobile.tsx`

## Validation
- Open `/scan` on phone, connect to desktop session.
- Single Send Photo at `high` quality: received thumbnail visibly sharper, file size noticeably larger.
- Burst mode at the lowest interval setting: frames arrive ~2× faster than before.
- Confirm no upload errors on slower connections (quality is still bounded by JPEG, not raw).
