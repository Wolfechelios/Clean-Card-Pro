/**
 * WebAudio-based sound effects — no bundled mp3/wav files needed.
 * All sounds are synthesised at runtime via the Web Audio API.
 */

let audioCtx: AudioContext | null = null;
let warmedUp = false;

function ctx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

/**
 * Call during a direct user gesture (tap / click) to unlock AudioContext.
 * Safe to call multiple times — only does real work once.
 */
export async function warmUpAudio(): Promise<void> {
  try {
    const c = ctx();
    if (c.state === "suspended") {
      await c.resume();
    }
    if (!warmedUp) {
      // Play a silent oscillator to fully "prime" the audio pipeline
      const osc = c.createOscillator();
      const gain = c.createGain();
      gain.gain.value = 0; // silent
      osc.connect(gain).connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + 0.01);
      warmedUp = true;
    }
  } catch {
    // Ignore — audio not critical
  }
}

/** Resume AudioContext (sync best-effort). */
function ensureResumed() {
  const c = ctx();
  if (c.state === "suspended") c.resume().catch(() => {});
}

// ── Shutter click ──────────────────────────────────────────────────────────
export function playShutterBeep() {
  try {
    ensureResumed();
    const c = ctx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1800, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, c.currentTime + 0.12);
    gain.gain.setValueAtTime(0.5, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.15);
    osc.connect(gain).connect(c.destination);
    osc.start(c.currentTime);
    osc.stop(c.currentTime + 0.15);
  } catch {
    // Ignore — audio not critical
  }
}

// ── Ka-ching ($10+ card) ──────────────────────────────────────────────────
export function playKachingBeep() {
  try {
    ensureResumed();
    const c = ctx();
    const now = c.currentTime;

    // Two-tone "cha-ching"
    [880, 1320].forEach((freq, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.12);
      gain.gain.linearRampToValueAtTime(0.35, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.25);
      osc.connect(gain).connect(c.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.25);
    });
  } catch {
    // Ignore
  }
}

// ── Jackpot alert ($50+ card) ─────────────────────────────────────────────
export function playJackpotBeep() {
  try {
    ensureResumed();
    const c = ctx();
    const now = c.currentTime;

    // Rising arpeggio C5-E5-G5-C6
    [523, 659, 784, 1047].forEach((freq, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.1;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.3, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.35);
    });
  } catch {
    // Ignore
  }
}
