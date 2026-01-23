// Placeholder for optional on-device model support.
// Keep shape stable so the queue processor can safely fall back to cloud identify.

export async function identifyCardOnDevice(_blob: Blob): Promise<
  | {
      name?: string;
      set?: string | null;
      number?: string | null;
    }
  | null
> {
  return null;
}
