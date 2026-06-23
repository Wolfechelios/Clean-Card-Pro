# Safari Camera Controls

Rapid Scan now uses a simple Safari-first camera surface.

## Visible controls

```txt
Camera / Lens selector
Start Camera / Stop
Zoom slider
Zoom - / + buttons
Torch button when Safari exposes torch support
Tap preview to focus/expose when supported
Reset camera controls
Capture button
Clear queue/recent scans
```

## Safari limits

Safari decides which hardware controls are exposed for each iPhone lens. Some lenses expose hardware zoom and torch; some only allow screen zoom or autofocus. The UI keeps the button visible but disables unsupported controls instead of hiding the whole control strip.

## Flow

```txt
Start Camera
  ↓
Preview opens with playsInline Safari mode
  ↓
User adjusts zoom / torch / lens / tap focus
  ↓
Capture
  ↓
Image goes to IndexedDB queue
  ↓
queueProcessor prices it with RapidScan lookup pipeline
```
