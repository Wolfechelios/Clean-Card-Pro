export type FeatureFlags = {
  onDeviceLLM: boolean;
};

export const DEFAULT_FLAGS: FeatureFlags = {
  onDeviceLLM: false,
};

const KEY = "cleancards-feature-flags";

export function loadLocalFlags(): Partial<FeatureFlags> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<FeatureFlags>;
  } catch {
    return {};
  }
}
