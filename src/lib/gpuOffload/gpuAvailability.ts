import { getGpuServerBaseUrl } from "./gpuSettings";

const TIMEOUT_MS = 1800;
let cached: { ok: boolean; at: number; caps?: any; serverType?: string } | null = null;
const TTL_MS = 15000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => {
      clearTimeout(id);
      resolve(v);
    }).catch((e) => {
      clearTimeout(id);
      reject(e);
    });
  });
}

export async function checkGpuServerAvailable(force = false): Promise<{ ok: boolean; caps?: any }>
{
  const now = Date.now();
  if (!force && cached && now - cached.at < TTL_MS) return { ok: cached.ok, caps: cached.caps };

  const base = getGpuServerBaseUrl();
  if (!base) {
    cached = { ok: false, at: now };
    return { ok: false };
  }

  try {
    const res = await withTimeout(fetch(`${base}/health`, { method: "GET" }), TIMEOUT_MS);
    if (!res.ok) throw new Error(`health ${res.status}`);
    const json = await res.json().catch(() => ({}));
    cached = { ok: true, at: now, caps: json?.capabilities ?? json };
    return { ok: true, caps: cached.caps };
  } catch {
    cached = { ok: false, at: now };
    return { ok: false };
  }
}

export function invalidateGpuAvailabilityCache(): void {
  cached = null;
}
