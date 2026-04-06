

## Plan: Improve Rapid Scan Camera UI

### What changes

Restructure the RapidScanCamera render layout from a side-panel control design to an integrated viewfinder-first layout with controls overlaid on and below the camera feed. The goal is faster scanning with fewer visual distractions.

### Layout redesign

**Current:** Grid layout with camera on the left and a separate controls panel on the right (300px sidebar with Camera heading, start/stop, torch, white balance, capture button, auto-timer, zoom reset, clear, tips, buffer status).

**New:** Single-column, viewfinder-dominant layout:

1. **Compact top bar** -- mode badge + total value + buffer count (single row, no mode toggle buttons visible by default; mode selector moves into a small dropdown or stays compact)

2. **Viewfinder** -- full-width, taller, with improved alignment frame (thicker corners, subtle gradient glow on corners, centered card silhouette). Remove the side panel entirely.

3. **Overlay controls on viewfinder** -- torch toggle and zoom indicator stay as small floating pills (top-right). Camera selector as a small pill (top-left) when multiple cameras exist.

4. **Bottom capture bar (below viewfinder)** -- a horizontal strip containing:
   - Large circular capture button (80px, centered, primary color, pulsing ring when ready)
   - Auto-timer toggle (left of capture)
   - Torch toggle (right of capture) 
   - This mimics native camera app UX

5. **Status strip** -- below capture bar: one-line status text + queue counts (queued/processing)

6. **Scanned cards list** -- unchanged, below everything

### Technical details

**File:** `src/components/scanner/RapidScanCamera.tsx` (render section, lines ~1217-1665)

Changes to the render return:
- Remove the `lg:grid-cols-[1fr_300px]` grid layout
- Move capture button into a centered bottom bar below the viewfinder with a large round button (w-20 h-20 rounded-full)
- Move start/stop camera into the capture button itself (tap to start, then tap to capture)
- Keep torch, auto-timer as smaller icon buttons flanking the main capture button
- Move camera device selector into a compact overlay pill on the viewfinder
- Move white balance control into a collapsible section or remove from main view (move to settings)
- Move buffer status into a small badge inline with the status line
- Remove the separate "Camera" panel card entirely
- Keep the mode toggle compact (already has icon-only on mobile)
- Improve alignment frame: thicker corner brackets (w-8 h-8, border-3), add subtle animation

### Files to edit

| File | Changes |
|------|---------|
| `src/components/scanner/RapidScanCamera.tsx` | Restructure render layout: remove side panel grid, add bottom capture bar with large round button, overlay controls on viewfinder, compact status line |

