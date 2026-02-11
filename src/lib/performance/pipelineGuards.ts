
let inFlight = 0;
export function canProcessFrame() {
  return inFlight < 2;
}
export function markFrameStart() {
  inFlight++;
}
export function markFrameEnd() {
  inFlight = Math.max(0, inFlight - 1);
}
