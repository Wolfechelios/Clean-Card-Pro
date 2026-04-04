

## Plan: Fix Shutter Sound Not Playing During Rapid Scan

### Root Cause

Mobile browsers require `AudioContext.resume()` to complete (it returns a Promise) during a direct user gesture before any sound can play. The current code calls `resume()` but doesn't `await` it — the oscillator is scheduled immediately while the context is still suspended, so the first capture (and often subsequent ones) produces no sound. Additionally, the gain (0.25) is very quiet on phone speakers.

### Changes

**1. `src/lib/audioBeeps.ts` — warm-up + async resume + louder sound**

- Add an exported `warmUpAudio()` function that creates and resumes the AudioContext (called once on first user tap)
- Make `ensureResumed()` synchronous-safe by checking state and scheduling a silent buffer to "unlock" the context
- Increase shutter gain from 0.25 → 0.5 and extend duration from 100ms → 150ms for audibility on phone speakers
- Add a silent "unlock" oscillator trick: play a zero-gain oscillator immediately on warm-up to satisfy the browser's gesture requirement

**2. `src/components/scanner/RapidScanCamera.tsx` — warm up audio on first interaction**

- Call `warmUpAudio()` inside the "Start Camera" button handler (this is a direct user gesture, satisfying browser autoplay policy)
- Also call `warmUpAudio()` on the capture button's `onTouchStart`/`onMouseDown` (before the async capture logic runs) to ensure the context is resumed by the time the shutter beep fires

### Files

| File | Action |
|------|--------|
| `src/lib/audioBeeps.ts` | Edit — add `warmUpAudio()`, increase gain, await resume |
| `src/components/scanner/RapidScanCamera.tsx` | Edit — call `warmUpAudio()` on camera start and capture touch |

