// Minimal local card helpers (kept small to avoid mixing business logic into UI).
// If you already have a richer local cache layer elsewhere, this remains compatible.

export async function insertCardDual(_args: any) {
  // Minimal placeholder that matches call sites.
  return { id: (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) };
}
