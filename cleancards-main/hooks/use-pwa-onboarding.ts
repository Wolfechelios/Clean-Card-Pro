import { useState, useEffect, useCallback } from "react";

const ONBOARDING_KEY = "pwa-onboarding-complete";
const ONBOARDING_VERSION = "1"; // Increment to show onboarding again after updates

interface UsePWAOnboardingReturn {
  shouldShowOnboarding: boolean;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
  isStandalone: boolean;
  isFirstLaunch: boolean;
}

export function usePWAOnboarding(): UsePWAOnboardingReturn {
  const [shouldShowOnboarding, setShouldShowOnboarding] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isFirstLaunch, setIsFirstLaunch] = useState(false);

  useEffect(() => {
    // Check if running as standalone PWA
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes("android-app://");

    setIsStandalone(standalone);

    // Only show onboarding for standalone PWA mode
    if (standalone) {
      const stored = localStorage.getItem(ONBOARDING_KEY);
      
      if (!stored) {
        // First launch ever
        setIsFirstLaunch(true);
        setShouldShowOnboarding(true);
      } else {
        try {
          const data = JSON.parse(stored);
          // Show if version is outdated
          if (data.version !== ONBOARDING_VERSION) {
            setShouldShowOnboarding(true);
          }
        } catch {
          // Invalid data, show onboarding
          setShouldShowOnboarding(true);
        }
      }
    }

    // Listen for display mode changes
    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const handleChange = (e: MediaQueryListEvent) => {
      setIsStandalone(e.matches);
      if (e.matches) {
        const stored = localStorage.getItem(ONBOARDING_KEY);
        if (!stored) {
          setIsFirstLaunch(true);
          setShouldShowOnboarding(true);
        }
      }
    };

    mediaQuery.addEventListener?.("change", handleChange);
    return () => mediaQuery.removeEventListener?.("change", handleChange);
  }, []);

  const completeOnboarding = useCallback(() => {
    setShouldShowOnboarding(false);
    setIsFirstLaunch(false);
    localStorage.setItem(
      ONBOARDING_KEY,
      JSON.stringify({
        version: ONBOARDING_VERSION,
        completedAt: Date.now(),
      })
    );
  }, []);

  const resetOnboarding = useCallback(() => {
    localStorage.removeItem(ONBOARDING_KEY);
    setShouldShowOnboarding(true);
    setIsFirstLaunch(true);
  }, []);

  return {
    shouldShowOnboarding,
    completeOnboarding,
    resetOnboarding,
    isStandalone,
    isFirstLaunch,
  };
}
