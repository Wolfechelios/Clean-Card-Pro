import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decryptValue } from "./apiKeyCrypto.ts";

interface ApiKeyRow {
  key_value: string;
}

/**
 * Gets a user-specific API key (decrypting if encrypted),
 * falling back to system environment variable.
 */
export async function getUserApiKey(
  supabaseClient: SupabaseClient,
  userId: string,
  keyName: string,
  envFallback: string
): Promise<string | null> {
  try {
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
        let value = row.key_value;
        try {
          value = await decryptValue(row.key_value);
        } catch {
          // Legacy plaintext value — use as-is
        }
        console.log(`Using user-specific ${keyName}`);
        return value;
      }
    }

    const envValue = Deno.env.get(envFallback);
    if (envValue) {
      console.log(`Falling back to system ${envFallback}`);
      return envValue;
    }

    return null;
  } catch (err) {
    console.error(`Error fetching API key ${keyName}:`, err);
    return Deno.env.get(envFallback) || null;
  }
}

export const API_KEY_NAMES = {
  GEMINI: "GEMINI_API_KEY",
  GOOGLE_VISION: "GOOGLE_VISION_API_KEY",
  PERPLEXITY: "PERPLEXITY_API_KEY",
} as const;
