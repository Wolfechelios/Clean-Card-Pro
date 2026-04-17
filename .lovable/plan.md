

## Plan: Add Remote Scan Settings (Desktop Pairing Configuration)

### What's actually happening

The "Remote" feature **does exist** — it's the `RemoteScanDesktop` component on the **Scan page → USB tab** that shows a QR code your phone scans to stream camera frames to your computer. But:

1. There are **no remote-scan settings anywhere in the Settings page** — nothing for session lifetime, auto-queue toggle, image quality, burst mode defaults, etc.
2. The `RemoteScanDesktop` component itself has an `autoQueue` state that's never exposed as a control.
3. There's no way to find or manage the feature without opening Scan → USB tab.

So the "remote settings for the computer" you're looking for genuinely don't exist yet. I'll add them.

### Where settings will live

`src/pages/SettingsPage.tsx` — add a new **"Remote Scanning"** card section with:

| Setting | Default | Effect |
|---|---|---|
| Auto-queue received photos | On | When phone sends a frame, automatically push it into the rapid-scan queue (current hardcoded behavior) |
| Session timeout | 30 min | Auto-expire idle pairing sessions |
| Image quality on phone | High | Phone-side JPEG quality (passes through realtime payload) |
| Burst capture interval | 1.5s | Default delay between auto-shots in mobile burst mode |
| Show received-photo grid | On | Toggle the desktop thumbnail feed |
| Sound on photo received | On | Beep when a frame arrives on desktop |
| Default scan tab | Rapid | Which tab opens first on `/scan` (Rapid / USB / Upload) — surfaces Remote faster |

### Files to change

1. **`src/hooks/use-scanner-settings.ts`**  
   Add `RemoteScanSettings` fields to `ScannerSettings` interface + `DEFAULT_SETTINGS`:
   - `remoteAutoQueue: boolean`
   - `remoteSessionTimeoutMin: number`
   - `remotePhoneImageQuality: "low" | "medium" | "high"`
   - `remoteBurstIntervalSec: number`
   - `remoteShowPhotoGrid: boolean`
   - `remoteSoundOnReceive: boolean`
   - `defaultScanTab: "rapid" | "usb" | "upload"`

2. **`src/pages/SettingsPage.tsx`**  
   Add a new "Remote Scanning" `Card` section with switches/selects bound to the new settings.

3. **`src/components/scanner/RemoteScanDesktop.tsx`**  
   - Read `useScannerSettings()` and respect: `remoteAutoQueue`, `remoteShowPhotoGrid`, `remoteSoundOnReceive`.
   - When `remoteAutoQueue` is off, show a "Queue all" button instead.
   - When a frame arrives and sound is enabled, play `audioBeeps` shutter snap.

4. **`src/components/scanner/RemoteScanMobile.tsx`**  
   - Respect `remotePhoneImageQuality` (passed to canvas `toDataURL` quality).
   - Respect `remoteBurstIntervalSec` for burst loop delay.

5. **`src/components/Scanner.tsx`**  
   - Replace `defaultValue="rapid"` on `<Tabs>` with `settings.defaultScanTab`.

6. **`src/components/scanner/RemoteScanDesktop.tsx`** (session timeout)  
   - On `generateSession`, store `expires_at = now() + remoteSessionTimeoutMin`. If session row exists past expiry, refresh.

### Visibility / discoverability

Add a small "Open Remote Scan" link under the Settings section that deep-links to `/scan?tab=usb#remote`, and parse that hash in `Scanner.tsx` to scroll the Remote card into view.

### Out of scope (will not touch)

- Phone-side QR scanner UI internals
- `remote_scan_sessions` DB schema (no new columns needed; timeout is client-side)
- Realtime channel protocol
- Existing rapid-scan ordering work (separate task you previously paused)

