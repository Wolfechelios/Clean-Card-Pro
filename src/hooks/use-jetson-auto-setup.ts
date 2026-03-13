/**
 * Auto-discovery & auto-setup hook for the Jetson vision coprocessor.
 * 
 * On mount (or manual trigger):
 * 1. Scans common LAN subnets for a Jetson /discover endpoint
 * 2. If found, pulls config and auto-configures scanner settings
 * 3. Runs a full health check
 * 4. Reports status back to the UI
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { useScannerSettings } from "@/hooks/use-scanner-settings";
import { jetsonHealth, type JetsonHealth } from "@/lib/jetsonClient";

export type SetupPhase =
  | "idle"
  | "scanning"
  | "found"
  | "configuring"
  | "health-check"
  | "ready"
  | "failed";

export interface DiscoverPayload {
  service: string;
  version: string;
  hostname: string;
  ip: string;
  port: number;
  base_url: string;
  endpoints: { path: string; method: string; desc: string }[];
}

export interface AutoSetupState {
  phase: SetupPhase;
  progress: number;          // 0–100
  scannedCount: number;
  totalToScan: number;
  foundIp: string | null;
  discover: DiscoverPayload | null;
  health: JetsonHealth | null;
  error: string | null;
  log: string[];
}

const INITIAL: AutoSetupState = {
  phase: "idle",
  progress: 0,
  scannedCount: 0,
  totalToScan: 0,
  foundIp: null,
  discover: null,
  health: null,
  error: null,
  log: [],
};

// Common Jetson IPs to try first (fast path)
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

export function useJetsonAutoSetup() {
  const [state, setState] = useState<AutoSetupState>(INITIAL);
  const { settings, updateSettings } = useScannerSettings();
  const abortRef = useRef(false);

  const addLog = useCallback((msg: string) => {
    setState(prev => ({ ...prev, log: [...prev.log, `[${new Date().toLocaleTimeString()}] ${msg}`] }));
  }, []);

  const scan = useCallback(async (customIp?: string) => {
    abortRef.current = false;
    setState({ ...INITIAL, phase: "scanning" });

    // Phase 1: If user provided an IP, try it directly
    if (customIp) {
      setState(prev => ({ ...prev, totalToScan: 1 }));
      addLog(`Probing ${customIp}...`);
      const result = await probeIp(customIp);
      if (result) {
        setState(prev => ({
          ...prev,
          phase: "found",
          foundIp: customIp,
          discover: result,
          progress: 50,
          scannedCount: 1,
        }));
        addLog(`✓ Found Jetson at ${customIp}`);
        await configureAndVerify(customIp, result);
        return;
      }
      // Fall through to subnet scan
      addLog(`Not found at ${customIp}, scanning subnet...`);
    }

    // Phase 2: Try priority IPs
    addLog("Trying known Jetson addresses...");
    for (const ip of PRIORITY_IPS) {
      if (abortRef.current) return;
      const result = await probeIp(ip);
      if (result) {
        setState(prev => ({
          ...prev,
          phase: "found",
          foundIp: ip,
          discover: result,
          progress: 50,
        }));
        addLog(`✓ Found Jetson at ${ip} (priority list)`);
        await configureAndVerify(ip, result);
        return;
      }
    }

    // Phase 3: Full subnet scan
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
        ...prev,
        scannedCount: scanned,
        progress: Math.round((scanned / total) * 45) + 5,
      }));

      const found = results.find(r => r.r !== null);
      if (found && found.r) {
        setState(prev => ({
          ...prev,
          phase: "found",
          foundIp: found.ip,
          discover: found.r,
          progress: 50,
        }));
        addLog(`✓ Found Jetson at ${found.ip}`);
        await configureAndVerify(found.ip, found.r);
        return;
      }
    }

    // Not found
    setState(prev => ({
      ...prev,
      phase: "failed",
      error: "No Jetson vision server found on the network",
      progress: 100,
    }));
    addLog("✗ Scan complete — no Jetson found");
  }, [addLog]);

  const configureAndVerify = useCallback(async (ip: string, discover: DiscoverPayload) => {
    // Phase: Configure
    setState(prev => ({ ...prev, phase: "configuring", progress: 60 }));
    addLog(`Configuring vision provider → ${ip}:${discover.port}`);

    updateSettings({
      visionProvider: "jetson",
      orinEnabled: true,
      orinServerUrl: ip,
    });

    // Phase: Health check
    setState(prev => ({ ...prev, phase: "health-check", progress: 80 }));
    addLog("Running health check...");

    try {
      const health = await jetsonHealth(5000);
      setState(prev => ({
        ...prev,
        phase: "ready",
        health,
        progress: 100,
      }));
      addLog(`✓ Jetson ready — GPU: ${health.gpu}, models: ${health.model_loaded ? "loaded" : "pending"}`);
    } catch (err: any) {
      setState(prev => ({
        ...prev,
        phase: "ready",
        progress: 100,
        health: null,
      }));
      addLog(`⚠ Health check failed (${err.message}) — server found but may be starting up`);
    }
  }, [addLog, updateSettings]);

  const cancel = useCallback(() => {
    abortRef.current = true;
    setState(prev => ({ ...prev, phase: "idle" }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current = true;
    setState(INITIAL);
  }, []);

  return { state, scan, cancel, reset };
}
