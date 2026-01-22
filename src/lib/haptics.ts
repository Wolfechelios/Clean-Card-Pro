export function hapticTap(_ms = 25) {
  try {
    // Best-effort; browsers vary.
    if (navigator.vibrate) navigator.vibrate(_ms);
  } catch {
    // ignore
  }
}
