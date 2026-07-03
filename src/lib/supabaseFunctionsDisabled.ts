// Supabase Disabled Remote Paths are intentionally disabled/removed.
// Do not route scanner, pricing, OCR, or identification through Supabase functions.

export async function disabledSupabaseFunctionInvoke<T = any>(
  functionName: string,
  _options?: any,
): Promise<{ data: T | null; error: { message: string; name: string } }> {
  const message = `Supabase Disabled Remote Paths are disabled in this app: ${functionName}`;
  console.warn(`[SupabaseFunctionsDisabled] ${message}`);
  return {
    data: null,
    error: {
      name: "SupabaseFunctionsDisabled",
      message,
    },
  };
}
