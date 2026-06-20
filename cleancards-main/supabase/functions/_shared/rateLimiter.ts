/**
 * Simple in-memory per-user rate limiter for edge functions.
 *
 * Uses a sliding-window counter stored in a Map.
 * Edge function instances are ephemeral so this is best-effort,
 * but it prevents rapid sequential abuse from a single user within
 * the same function instance.
 */

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

// Cleanup old entries every 60s to prevent memory leaks
let lastCleanup = Date.now();
function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Check if a request should be rate-limited.
 *
 * @param userId - The authenticated user's ID
 * @param functionName - Name of the edge function (for namespacing)
 * @param maxRequests - Max requests allowed in the window (default 30)
 * @param windowMs - Window duration in ms (default 60_000 = 1 minute)
 * @returns `{ allowed: boolean; retryAfterMs: number }`
 */
export function checkRateLimit(
  userId: string,
  functionName: string,
  maxRequests = 30,
  windowMs = 60_000
): { allowed: boolean; retryAfterMs: number } {
  cleanup();

  const key = `${functionName}:${userId}`;
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  existing.count += 1;

  if (existing.count > maxRequests) {
    return { allowed: false, retryAfterMs: existing.resetAt - now };
  }

  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Returns a 429 Response if rate-limited, or null if allowed.
 * Convenience wrapper for edge function handlers.
 */
export function rateLimitResponse(
  userId: string,
  functionName: string,
  corsHeaders: Record<string, string>,
  maxRequests = 30,
  windowMs = 60_000
): Response | null {
  const { allowed, retryAfterMs } = checkRateLimit(
    userId,
    functionName,
    maxRequests,
    windowMs
  );

  if (!allowed) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
        },
      }
    );
  }

  return null;
}
