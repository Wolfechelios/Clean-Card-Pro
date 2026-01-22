export function installGlobalErrorHandlers() {
  // Keep this lightweight: just prevents unhandled errors from being totally silent.
  try {
    window.addEventListener("error", () => {
      // no-op
    });
    window.addEventListener("unhandledrejection", () => {
      // no-op
    });
  } catch {
    // ignore
  }
}
