// Compatibility shim.
//
// Historically this module hard-disabled all Supabase edge-function calls
// while the app was being reworked to run OCR / lookup locally. That left
// the single-card upload scan flow and every bulk tool (pricing refresh,
// image lookup, rarity reanalyze, manual search, verify, import/export,
// Sell Assist, Visual Search, Price Hub, Graded Scan, Image Backfill,
// Import Cleaner, etc.) permanently broken because their edge functions
// still exist and are the only implementation of those features.
//
// The shim now transparently forwards to the real Supabase client so all
// existing call sites keep working without a sweeping refactor. New code
// should import { supabase } from "@/integrations/supabase/client" directly.

import { supabase } from "@/integrations/supabase/client";

export async function disabledSupabaseFunctionInvoke<T = any>(
  functionName: string,
  options?: any,
): Promise<{ data: T | null; error: { message: string; name: string } | null }> {
  try {
    const { data, error } = await supabase.functions.invoke(functionName, options);
    if (error) {
      return {
        data: (data as T | null) ?? null,
        error: {
          name: (error as any).name ?? "FunctionsError",
          message: (error as any).message ?? String(error),
        },
      };
    }
    return { data: (data as T) ?? null, error: null };
  } catch (err: any) {
    console.error(`[supabaseFunctionInvoke] ${functionName} failed`, err);
    return {
      data: null,
      error: {
        name: err?.name ?? "InvokeError",
        message: err?.message ?? String(err),
      },
    };
  }
}
