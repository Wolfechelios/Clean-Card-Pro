# Fix: iPad via Camo Studio not appearing in camera picker

## Why it's not showing today

Three problems compound:

1. **Selector hides itself with 1 device.** `CameraDeviceSelector.tsx` returns `null` when `devices.length <= 1`. After we filter out the front camera, a Mac with FaceTime + Camo can end up with just **1** rear/USB device — so the dropdown never renders even though Camo *is* in the list.
2. **No re-enumeration when Camo's source (the iPad) connects/disconnects.** Browsers cache `enumerateDevices()` and `devicechange` only fires when the *virtual driver itself* appears, not when its underlying source switches. Starting Camo Studio after the page loads often leaves the list stale until you hit Refresh.
3. **Label match is too narrow.** Camo Studio on macOS can expose the virtual cam under names like `"Camo"`, `"Reincubate Camo"`, or — depending on version — `"Camo 2"`, `"Reincubate Cam"`, or even a generic `"FaceTime HD Camera (Camo)"`. The current check only handles strings containing the substring `camo`, which is fine for those, **but** if the OS shows the iPad as `"iPad (2)"` or `"Apple iPad"` (which Camo Studio sometimes does in newer builds), it never matches phone-cam.

## Changes

### 1. `src/components/scanner/CameraDeviceSelector.tsx`
- Always render the dropdown when there is **≥1** device (drop the `<= 1` guard). A single-device user still benefits from the **Refresh** button to pull in Camo after starting it.

### 2. `src/hooks/use-camera-devices.tsx`
- **Broaden phone-cam detection** in `classifyPhoneCam`:
  - Match `camo`, `reincubate`, `ipad`, `apple ipad`, `ios camera`, `ios cam` → `lensType: "camo"`, label `"Camo (iPad)"` when `ipad` is present, otherwise `"Camo"`.
- **Auto-refresh on focus + interval poll** (cheap):
  - On `window` `focus` and `visibilitychange → visible`, call `refreshDevices()`.
  - Add a lightweight 4 s poll while the page is visible that compares device count + label hash and only updates state if it changed. This catches Camo Studio being launched after page load without requiring the user to click Refresh.
- **Better diagnostics**: `console.info("[camera-devices] enumerated", videoDevices.map(d => ({ label: d.label, lensType: d.lensType })))` so we can verify in DevTools exactly what the browser reports for the iPad.

### 3. `src/components/scanner/CameraDeviceSelector.tsx` UX
- When only Camo-style devices and no built-in webcam are present, keep the dropdown visible with a hint row "Refresh after starting Camo Studio" (small muted text under the select).

## Out of scope
- No changes to scan logic, OCR, pricing, or Yu-Gi-Oh routing.
- No backend / Supabase changes.

## Verification (after build)
1. Open `/scan` with Camo Studio **closed** → dropdown shows built-ins only.
2. Start Camo Studio + connect iPad → within ~4 s the dropdown should add **"Camo (iPad)"** with the phone icon (no manual refresh needed).
3. Disconnect iPad → entry disappears on next poll.
4. Console shows `[camera-devices] enumerated` with the actual OS-reported label, so if Camo uses an unexpected name we can extend the matcher.
