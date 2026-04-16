// 2s timeout for availability check to prevent blocking
const AVAILABILITY_CHECK_TIMEOUT_MS = 2000;

// Cache the result to avoid repeated network calls
let cachedLocalAvailable: boolean | null = null;
let lastCheckAt = 0;
const CACHE_TTL_MS = 30000; // Re-check every 30s

export async function isLocalLLMAvailable(): Promise<boolean> {
  const now = Date.now();
  
  // Return cached result if fresh
  if (cachedLocalAvailable !== null && now - lastCheckAt < CACHE_TTL_MS) {
    return cachedLocalAvailable;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AVAILABILITY_CHECK_TIMEOUT_MS);

    const res = await fetch("http://localhost:11434", {
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    cachedLocalAvailable = res.ok;
    lastCheckAt = now;
    return cachedLocalAvailable;
  } catch {
    cachedLocalAvailable = false;
    lastCheckAt = now;
    return false;
  }
}

export function isOnline(): boolean {
  return navigator.onLine;
}

// Force refresh the local LLM availability check
export function invalidateLocalLLMCache(): void {
  cachedLocalAvailable = null;
  lastCheckAt = 0;
}
