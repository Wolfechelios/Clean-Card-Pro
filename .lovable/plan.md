
Goal: fix microscope resolution selection so the app clearly shows the selected preset, negotiates the highest real stream the device/browser will allow, and removes any remaining preview crop/zoom ambiguity without changing the normal scanner flow.

1. Fix the microscope stream negotiation
- Update `src/hooks/use-microscope-camera.ts` so “Max” means “highest real native stream available”, not just a soft 4000×3000 request.
- Replace the current `ideal`-only approach with a stronger fallback ladder for common microscope sizes (for example: 4000×3000, 3840×2880, 3648×2736, 3264×2448, 2592×1944, then lower presets).
- Read the negotiated result from `track.getSettings()` after the stream starts instead of relying only on the initial `videoWidth/videoHeight`.
- Keep the fallback behavior so unsupported devices still connect cleanly.

2. Separate requested resolution from actual resolution
- Add distinct state for:
  - selected preset
  - actual negotiated stream size
  - device max/capability range when available
- If the browser falls back below the selected preset, surface that explicitly instead of making it look like the chosen preset succeeded.
- Update capture metadata to use the actual negotiated resolution, not only the requested preset.

3. Keep the microscope preview unzoomed and uncropped
- Ensure the microscope `<video>` uses a strict no-crop render (`object-contain`, no transform scale, no forced aspect crop).
- Keep the preview framed to fit the full feed so the microscope image is not artificially zoomed by layout.
- Preserve the current full-width preview behavior, but make the rendering rules explicit so future UI changes do not reintroduce crop/zoom.

4. Improve the Microscope Detail UI so it matches what the device is doing
- Update `src/components/scanner/MicroscopeDetailTab.tsx` to show:
  - requested preset
  - actual active stream resolution
  - max/native device resolution if detectable
- Change the existing resolution badge so it reflects the active stream, not just a stale value captured once.
- Add a small fallback/status message when “Max” resolves to something lower than 4000×3000, so it’s obvious whether the limit is the device, driver, or browser negotiation.

5. Make resolution changes refresh reliably
- Add a proper sync/update step after resolution changes so the UI refreshes when the track renegotiates.
- Listen for post-start metadata/resize updates so the displayed resolution cannot stay stale after switching presets.
- Keep the normal capture, identification, queueing, and microscope review flows unchanged.

Technical details
- Files to update:
  - `src/hooks/use-microscope-camera.ts`
  - `src/components/scanner/MicroscopeDetailTab.tsx`
  - optionally `src/hooks/use-scanner-settings.ts` only if I persist the preferred microscope resolution preset too
- I will not change the standard camera scanner, rapid scan, pricing, queueing, or card recognition behavior.
- I’ll also fix the existing `Badge` ref warning separately if it blocks scanner stability, but the microscope resolution issue will remain the primary change.

Validation
- Verify “Max” negotiates the highest available microscope resolution and reports the real active size.
- Verify switching between Max / 4K / 1080p / 720p updates the active resolution display correctly.
- Verify the preview shows the full feed with no added crop/zoom.
- Verify captures still route normally:
  - `full_card_scan` goes through identification
  - detail captures stay microscope-only
- Verify no regressions in the other scanner tabs.
