// Lightweight trace logger used by the rapid-scan queue processor.
export function logTrace(scope: string, ...args: unknown[]): void {
  if (typeof console !== "undefined" && typeof console.debug === "function") {
    console.debug(`[rapid:${scope}]`, ...args);
  }
}
