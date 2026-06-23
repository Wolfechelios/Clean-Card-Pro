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
Manual rotation lock: 0°, 90°, 180°, 270°
Rotate button over the preview
Reset camera controls
Capture button
Clear queue/recent scans
```

## Rotation lock

When an iPhone is laid flat with the lens facing the floor, Safari can report the camera orientation sideways. The app now has its own rotation lock instead of trusting the phone sensor.

Use:

```txt
0°   = normal portrait
90°  = rotate right
180° = upside down
270° = rotate left
```

The selected rotation is saved in localStorage and applied to both:

```txt
Live preview
Captured image sent to the scan queue
```

## Safari limits

Safari decides which hardware controls are exposed for each iPhone lens. Some lenses expose hardware zoom and torch; some only allow screen zoom or autofocus. The UI keeps the button visible but disables unsupported controls instead of hiding the whole control strip.

## Flow

```txt
Start Camera
  ↓
Preview opens with playsInline Safari mode
  ↓
User adjusts zoom / torch / lens / rotation / tap focus
  ↓
Capture
  ↓
Image is rotated if needed
  ↓
Image goes to IndexedDB queue
  ↓
queueProcessor prices it with RapidScan lookup pipeline
```
