import { getDeviceTier } from "@/lib/performance/deviceTier";

let inFlight = 0;
export function canProcessFrame() {
  return inFlight < getDeviceTier().maxInFlightFrames;
}
export function markFrameStart() {
  inFlight++;
}
export function markFrameEnd() {
  inFlight = Math.max(0, inFlight - 1);
}
