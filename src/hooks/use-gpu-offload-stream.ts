import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { GpuWsClient } from "@/lib/gpuOffload/gpuWsClient";
import type { GpuOffloadStatus, GpuPerfSnapshot, GpuStreamServerResult } from "@/lib/gpuOffload/types";
import { getGpuStreamPrefs } from "@/lib/gpuOffload/gpuSettings";

export function useGpuOffloadStream(opts?: { autoConnect?: boolean }) {
  const [status, setStatus] = useState<GpuOffloadStatus>("disconnected");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<GpuStreamServerResult | null>(null);
  const [perf, setPerf] = useState<GpuPerfSnapshot>({
    rttMs: null,
    serverMs: null,
    fpsOut: 0,
    fpsIn: 0,
    dropped: 0,
    lastMessageAt: null,
  });

  const clientRef = useRef<GpuWsClient | null>(null);

  const client = useMemo(() => {
    const c = new GpuWsClient({
      onStatus: (s, err) => {
        setStatus(s);
        setStatusError(err ?? null);
      },
      onResult: (r) => setLastResult(r),
      onPerf: (p) => setPerf(p),
    });
    clientRef.current = c;
    return c;
  }, []);

  useEffect(() => {
    if (opts?.autoConnect) {
      client.connect();
    }
    return () => client.disconnect();
  }, [client, opts?.autoConnect]);

  const connect = useCallback(() => client.connect(), [client]);
  const disconnect = useCallback(() => client.disconnect(), [client]);

  const sendFrame = useCallback(
    (jpegDataUrl: string) => {
      const { targetWidth } = getGpuStreamPrefs();
      // If caller already downscaled, just send.
      // If not, caller should downscale; we keep this hook lightweight.
      void targetWidth;
      return client.sendFrame(jpegDataUrl);
    },
    [client]
  );

  return {
    status,
    statusError,
    lastResult,
    perf,
    sessionId: client.getSessionId(),
    connect,
    disconnect,
    sendFrame,
  };
}
