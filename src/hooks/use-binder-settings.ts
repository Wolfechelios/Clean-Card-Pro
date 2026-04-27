import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "binder-picture-settings";

export type ImageDisplayMode = "full" | "thumbnail" | "hidden";
export type ImageFitMode = "cover" | "contain";
export type CardSizeMode = "compact" | "standard" | "large";
export type MissingStyle = "empty" | "silhouette" | "logo";

export interface BinderSettings {
  imageDisplay: ImageDisplayMode;
  imageFit: ImageFitMode;
  cardSize: CardSizeMode;
  missingStyle: MissingStyle;
  foilGlow: boolean;
  showCardName: boolean;
}

export const DEFAULT_BINDER_SETTINGS: BinderSettings = {
  imageDisplay: "full",
  imageFit: "cover",
  cardSize: "standard",
  missingStyle: "empty",
  foilGlow: true,
  showCardName: false,
};

export const CARD_SIZE_PX: Record<CardSizeMode, number> = {
  compact: 90,
  standard: 120,
  large: 160,
};

export function useBinderSettings() {
  const [settings, setSettings] = useState<BinderSettings>(DEFAULT_BINDER_SETTINGS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSettings({ ...DEFAULT_BINDER_SETTINGS, ...JSON.parse(raw) });
    } catch {
      // ignore
    }
  }, []);

  const update = useCallback((patch: Partial<BinderSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSettings(DEFAULT_BINDER_SETTINGS);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return { settings, update, reset };
}
