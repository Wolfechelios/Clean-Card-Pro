## Problem

On the phone, the Rapid Scan page crashes to the global ErrorBoundary with:

> A `<Select.Item />` must have a value prop that is not an empty string.

Root cause: `src/components/scanner/CameraDeviceSelector.tsx` renders one `SelectItem` per enumerated camera using `value={device.deviceId}`. On mobile browsers (notably iOS Safari and some Android WebViews), `navigator.mediaDevices.enumerateDevices()` returns entries with `deviceId === ""` until camera permission has been granted to a labeled device. Radix Select throws synchronously on that empty value, the React tree unmounts, and the user sees the error screen instead of the scanner.

## Fix

Single, surgical change in `src/components/scanner/CameraDeviceSelector.tsx`:

1. Filter the `devices` array to drop any entry whose `deviceId` is missing or an empty string before rendering the `Select`.
2. If the filtered list is empty, fall through to the existing "No cameras found / Finding cameras…" button instead of mounting `Select`.
3. Guard `selectedDeviceId` the same way — only pass it to `Select` when it's a non-empty string; otherwise pass `undefined` so Radix shows the placeholder cleanly.

No other files, no behavior changes to identification, queue, or save logic.

## Verification

- Reload `/scan` on the phone — the page should render the scanner (or the "Finding cameras…" button) instead of the error screen.
- Once camera permission is granted, the device list populates and selection works as before.
- Desktop behavior is unchanged because desktop browsers always return non-empty `deviceId`s.
