import { supabase } from "@/integrations/supabase/client";

export type FeatureFlagKey =
  | "rapidScan"
  | "binderScan"
  | "visualSearch"
  | "predictions"
  | "sellAssist"
  | "gradedScan"
  | "priceHub"
  | "imageBackfill"
  | "importCleaner"
  | "onDeviceLLM";

export type FeatureFlags = Record<FeatureFlagKey, boolean>;

export const DEFAULT_FLAGS: FeatureFlags = {
  rapidScan: true,
  binderScan: false,
  visualSearch: false,
  predictions: false,
  sellAssist: false,
  gradedScan: true,
  priceHub: true,
  imageBackfill: false,
  importCleaner: false,
  onDeviceLLM: false,
};

const LS_KEY = "card_scout_feature_flags_v1";

export function loadLocalFlags(): Partial<FeatureFlags> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch {
    return {};
  }
}

export function saveLocalFlags(flags: FeatureFlags) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(flags));
  } catch {
    // ignore
  }
}

export function mergeFlags(...parts: Array<Partial<FeatureFlags> | undefined | null>): FeatureFlags {
  return Object.assign({}, DEFAULT_FLAGS, ...parts);
}

// Supabase table: user_feature_flags (see migration)
export async function fetchRemoteFlags(userId: string): Promise<Partial<FeatureFlags>> {
  const { data, error } = await supabase
    .from("user_feature_flags")
    .select("flag_key, enabled")
    .eq("user_id", userId);

  if (error) throw error;

  const out: Partial<FeatureFlags> = {};
  for (const row of data ?? []) {
    const key = row.flag_key as FeatureFlagKey;
    if (key in DEFAULT_FLAGS) {
      out[key] = !!row.enabled;
    }
  }
  return out;
}

export async function setRemoteFlag(userId: string, flag: FeatureFlagKey, enabled: boolean) {
  const { error } = await supabase
    .from("user_feature_flags")
    .upsert({ user_id: userId, flag_key: flag, enabled }, { onConflict: "user_id,flag_key" });
  if (error) throw error;
}
