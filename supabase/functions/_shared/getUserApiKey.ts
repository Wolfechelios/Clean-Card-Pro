import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

interface ApiKeyRow {
  key_value: string;
}

/**
 * Gets a user-specific API key, falling back to system environment variable
 * @param supabaseClient - Authenticated Supabase client
 * @param userId - The user's ID
 * @param keyName - The name of the key (e.g., "GEMINI_API_KEY", "GOOGLE_VISION_API_KEY")
 * @param envFallback - The environment variable name to fall back to
 */
export async function getUserApiKey(
  supabaseClient: SupabaseClient,
  userId: string,
  keyName: string,
  envFallback: string
): Promise<string | null> {
  try {
    // First, try to get user-specific key
    const { data, error } = await supabaseClient
      .from("user_api_keys")
      .select("key_value")
      .eq("user_id", userId)
      .eq("key_name", keyName)
      .eq("is_active", true)
      .single();

    if (!error && data) {
      const row = data as ApiKeyRow;
      if (row.key_value) {
        console.log(`Using user-specific ${keyName}`);
        return row.key_value;
      }
    }

    // Fall back to system environment variable
    const envValue = Deno.env.get(envFallback);
    if (envValue) {
      console.log(`Falling back to system ${envFallback}`);
      return envValue;
    }

    return null;
  } catch (err) {
    console.error(`Error fetching API key ${keyName}:`, err);
    // Fall back to system environment variable on error
    return Deno.env.get(envFallback) || null;
  }
}

/**
 * Standard key name mappings
 */
export const API_KEY_NAMES = {
  GEMINI: "GEMINI_API_KEY",
  GOOGLE_VISION: "GOOGLE_VISION_API_KEY",
  PERPLEXITY: "PERPLEXITY_API_KEY",
} as const;
