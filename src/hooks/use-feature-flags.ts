import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_FLAGS,
  fetchRemoteFlags,
  loadLocalFlags,
  mergeFlags,
  saveLocalFlags,
  setRemoteFlag,
  type FeatureFlagKey,
  type FeatureFlags,
} from "@/lib/featureFlags";

export function useFeatureFlags() {
  const [flags, setFlags] = useState<FeatureFlags>(() => mergeFlags(loadLocalFlags()));
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!mounted) return;
        setUserId(data.user?.id ?? null);
      } finally {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        // Local is instant, remote overrides if available.
        const local = loadLocalFlags();
        if (!mounted) return;
        setFlags(mergeFlags(local));

        if (userId) {
          const remote = await fetchRemoteFlags(userId);
          if (!mounted) return;
          const merged = mergeFlags(local, remote);
          setFlags(merged);
          saveLocalFlags(merged);
        }
      } catch {
        // offline / permission / table missing: keep local
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [userId]);

  const api = useMemo(() => {
    return {
      flags,
      loading,
      defaults: DEFAULT_FLAGS,
      async setFlag(flag: FeatureFlagKey, enabled: boolean) {
        const next = { ...flags, [flag]: enabled } as FeatureFlags;
        setFlags(next);
        saveLocalFlags(next);
        if (userId) {
          try {
            await setRemoteFlag(userId, flag, enabled);
          } catch {
            // keep local
          }
        }
      },
    };
  }, [flags, loading, userId]);

  return api;
}
