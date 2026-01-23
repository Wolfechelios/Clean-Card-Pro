import { useEffect } from "react";

export function useVoiceCommand(opts: {
  enabled: boolean;
  keyword: string;
  onMatch: () => void;
}) {
  useEffect(() => {
    // Speech recognition is optional; keep this as a safe no-op on browsers without support.
    if (!opts.enabled) return;
  }, [opts.enabled, opts.keyword]);

  return {
    listening: false,
  };
}
