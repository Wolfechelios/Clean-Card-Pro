/**
 * Bidirectional auto-discovery & setup hook for the Jetson vision coprocessor.
 *
 * Supports two directions:
 *   1. SER8 → Jetson  (client discovers server)
 *   2. Jetson → SER8  (server pushes to client / client polls)
 *
 * After connection, the SER8 registers itself back with the Jetson
 * so both sides are aware of each other.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useScannerSettings } from "@/hooks/use-scanner-settings";
import { jetsonHealth, type JetsonHealth } from "@/lib/jetsonClient";

export type SetupPhase =
  | "idle"
  | "scanning"
  | "found"
  | "configuring"
  | "registering"
  | "health-check"
  | "ready"
  | "failed"
  | "listening";

export type SetupDirection = "client-to-server" | "server-to-client";

export interface DiscoverPayload {
  service: string;
  version: string;
  hostname: string;
  ip: string;
  port: number;
  base_url: string;
  endpoints: { path: string; method: string; desc: string }[];
  push_connect?: boolean;
}

export interface AutoSetupState {
  phase: SetupPhase;
  direction: SetupDirection;
  progress: number;
  scannedCount: number;
  totalToScan: number;
  foundIp: string | null;
  discover: DiscoverPayload | null;
  health: JetsonHealth | null;
  error: string | null;
  log: string[];
  registered: boolean;
}

const INITIAL: AutoSetupState = {
  phase: "idle",
  direction: "client-to-server",
  progress: 0,
  scannedCount: 0,
  totalToScan: 0,
  foundIp: null,
  discover: null,
  health: null,
  error: null,
  log: [],
  registered: false,
};

const PRIORITY_IPS = [
  "192.168.1.37",
  "192.168.1.100",
  "192.168.0.37",
  "192.168.0.100",
  "10.0.0.37",
  "10.0.0.100",
];

const PROBE_TIMEOUT = 1500;
const BATCH_SIZE = 20;
const LISTEN_POLL_INTERVAL = 3000;

async function probeIp(ip: string, port = 8000): Promise<DiscoverPayload | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT);
  try {
    const res = await fetch(`http://${ip}:${port}/discover`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.service === "jetson-vision-coprocessor") return data;
    return null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function generateSubnetIps(base: string): string[] {
  const parts = base.split(".");
  const prefix = parts.slice(0, 3).join(".");
  const ips: string[] = [];
  for (let i = 1; i <= 254; i++) {
    const ip = `${prefix}.${i}`;
    if (!PRIORITY_IPS.includes(ip)) ips.push(ip);
  }
  return ips;
}

/** Register this SER8 client with the Jetson so it knows where we are */
async function registerWithJetson(jetsonIp: string, jetsonPort: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${jetsonIp}:${jetsonPort}/register-client`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ip: window.location.hostname,
        port: parseInt(window.location.port || "5173"),
        name: `SER8-${navigator.userAgent.includes("Mobile") ? "mobile" : "desktop"}`,
        user_agent: navigator.userAgent.slice(0, 120),
        capabilities: ["scan", "queue", "live-stream"],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Send heartbeat to Jetson to keep registration alive */
async function sendHeartbeat(jetsonIp: string, jetsonPort: number): Promise<boolean> {
  try {
    const res = await fetch(`http://${jetsonIp}:${jetsonPort}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ip: window.location.hostname,
        port: parseInt(window.location.port || "5173"),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function useJetsonAutoSetup() {
  const [state, setState] = useState<AutoSetupState>(INITIAL);
  const { settings, updateSettings } = useScannerSettings();
  const abortRef = useRef(false);
  const listenRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addLog = useCallback((msg: string) => {
    setState(prev => ({ ...prev, log: [...prev.log, `[${new Date().toLocaleTimeString()}] ${msg}`] }));
  }, []);

  // ── Direction 1: SER8 → Jetson (forward discovery) ──────

  const scan = useCallback(async (customIp?: string) => {
    abortRef.current = false;
    setState({ ...INITIAL, phase: "scanning", direction: "client-to-server" });

    if (customIp) {
      setState(prev => ({ ...prev, totalToScan: 1 }));
      addLog(`Probing ${customIp}...`);
      const result = await probeIp(customIp);
      if (result) {
        setState(prev => ({
          ...prev, phase: "found", foundIp: customIp, discover: result, progress: 40, scannedCount: 1,
        }));
        addLog(`✓ Found Jetson at ${customIp}`);
        await configureAndVerify(customIp, result);
        return;
      }
      addLog(`Not found at ${customIp}, scanning subnet...`);
    }

    addLog("Trying known Jetson addresses...");
    for (const ip of PRIORITY_IPS) {
      if (abortRef.current) return;
      const result = await probeIp(ip);
      if (result) {
        setState(prev => ({ ...prev, phase: "found", foundIp: ip, discover: result, progress: 40 }));
        addLog(`✓ Found Jetson at ${ip} (priority list)`);
        await configureAndVerify(ip, result);
        return;
      }
    }

    const subnets = ["192.168.1", "192.168.0", "10.0.0"];
    const allIps = subnets.flatMap(s => generateSubnetIps(`${s}.1`));
    const total = allIps.length;
    setState(prev => ({ ...prev, totalToScan: total }));
    addLog(`Scanning ${total} addresses across ${subnets.length} subnets...`);

    let scanned = 0;
    for (let i = 0; i < allIps.length; i += BATCH_SIZE) {
      if (abortRef.current) return;
      const batch = allIps.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map(ip => probeIp(ip).then(r => ({ ip, r }))));
      scanned += batch.length;
      setState(prev => ({
        ...prev, scannedCount: scanned, progress: Math.round((scanned / total) * 35) + 5,
      }));
      const found = results.find(r => r.r !== null);
      if (found && found.r) {
        setState(prev => ({ ...prev, phase: "found", foundIp: found.ip, discover: found.r, progress: 40 }));
        addLog(`✓ Found Jetson at ${found.ip}`);
        await configureAndVerify(found.ip, found.r);
        return;
      }
    }

    setState(prev => ({
      ...prev, phase: "failed", error: "No Jetson vision server found on the network", progress: 100,
    }));
    addLog("✗ Scan complete — no Jetson found");
  }, [addLog]);

  // ── Direction 2: Jetson → SER8 (reverse / listen mode) ──

  const startListening = useCallback(() => {
    abortRef.current = false;
    setState({ ...INITIAL, phase: "listening", direction: "server-to-client" });
    addLog("Listening for Jetson push-connect...");
    addLog("Polling known addresses for incoming connection...");

    // Poll the Jetson's /discover endpoint on common IPs
    // The Jetson may come online at any time
    let pollCount = 0;
    listenRef.current = setInterval(async () => {
      if (abortRef.current) {
        if (listenRef.current) clearInterval(listenRef.current);
        return;
      }
      pollCount++;
      // Cycle through priority IPs each poll
      const ip = PRIORITY_IPS[pollCount % PRIORITY_IPS.length];
      const result = await probeIp(ip);
      if (result) {
        if (listenRef.current) clearInterval(listenRef.current);
        setState(prev => ({
          ...prev, phase: "found", foundIp: ip, discover: result, progress: 40,
          direction: "server-to-client",
        }));
        addLog(`✓ Jetson came online at ${ip} (reverse discovery)`);
        await configureAndVerify(ip, result);
      } else {
        setState(prev => ({
          ...prev, scannedCount: pollCount,
          log: prev.log.length > 0 && prev.log[prev.log.length - 1].includes("Polling")
            ? [...prev.log.slice(0, -1), `[${new Date().toLocaleTimeString()}] Polling... (attempt ${pollCount})`]
            : [...prev.log, `[${new Date().toLocaleTimeString()}] Polling... (attempt ${pollCount})`],
        }));
      }
    }, LISTEN_POLL_INTERVAL);
  }, [addLog]);

  const stopListening = useCallback(() => {
    abortRef.current = true;
    if (listenRef.current) {
      clearInterval(listenRef.current);
      listenRef.current = null;
    }
    setState(prev => ({ ...prev, phase: "idle" }));
  }, []);

  // ── Shared: Configure + Register + Verify ───────────────

  const configureAndVerify = useCallback(async (ip: string, discover: DiscoverPayload) => {
    // Configure
    setState(prev => ({ ...prev, phase: "configuring", progress: 50 }));
    addLog(`Configuring vision provider → ${ip}:${discover.port}`);
    updateSettings({
      visionProvider: "jetson",
      orinEnabled: true,
      orinServerUrl: ip,
    });

    // Register SER8 with Jetson (bidirectional handshake)
    setState(prev => ({ ...prev, phase: "registering", progress: 65 }));
    addLog("Registering this client with Jetson...");
    const regOk = await registerWithJetson(ip, discover.port);
    if (regOk) {
      addLog("✓ Registered with Jetson — bidirectional link established");
      setState(prev => ({ ...prev, registered: true }));
    } else {
      addLog("⚠ Registration failed — one-way connection only");
    }

    // Health check
    setState(prev => ({ ...prev, phase: "health-check", progress: 80 }));
    addLog("Running health check...");
    try {
      const health = await jetsonHealth(5000);
      setState(prev => ({ ...prev, phase: "ready", health, progress: 100 }));
      addLog(`✓ Jetson ready — GPU: ${health.gpu}, models: ${health.model_loaded ? "loaded" : "pending"}`);
    } catch (err: any) {
      setState(prev => ({ ...prev, phase: "ready", progress: 100, health: null }));
      addLog(`⚠ Health check failed (${err.message}) — server found but may be starting up`);
    }

    // Start heartbeat to keep registration alive
    if (regOk) {
      heartbeatRef.current = setInterval(() => {
        sendHeartbeat(ip, discover.port);
      }, 30_000);
    }
  }, [addLog, updateSettings]);

  const cancel = useCallback(() => {
    abortRef.current = true;
    if (listenRef.current) { clearInterval(listenRef.current); listenRef.current = null; }
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    setState(prev => ({ ...prev, phase: "idle" }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current = true;
    if (listenRef.current) { clearInterval(listenRef.current); listenRef.current = null; }
    if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    setState(INITIAL);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (listenRef.current) clearInterval(listenRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, []);

  return { state, scan, startListening, stopListening, cancel, reset };
}
