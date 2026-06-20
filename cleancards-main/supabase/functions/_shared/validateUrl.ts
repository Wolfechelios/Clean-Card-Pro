/**
 * SSRF Protection — validates user-supplied URLs before fetching.
 *
 * Blocks:
 *  - Cloud metadata endpoints (169.254.169.254, metadata.google, etc.)
 *  - Internal/private IPs (10.x, 172.16-31.x, 192.168.x, 127.x, ::1, fc00::)
 *  - Non-HTTP(S) schemes (file://, ftp://, gopher://, etc.)
 *  - Localhost and link-local hostnames
 */

const BLOCKED_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.google",
  "169.254.169.254",
  "metadata",
  "localhost",
  "0.0.0.0",
  "[::]",
  "[::1]",
]);

const PRIVATE_IP_PATTERNS = [
  /^127\./,               // loopback
  /^10\./,                // class A private
  /^172\.(1[6-9]|2\d|3[01])\./, // class B private
  /^192\.168\./,          // class C private
  /^169\.254\./,          // link-local / cloud metadata
  /^0\./,                 // "this" network
  /^fc00:/i,              // IPv6 unique local
  /^fd/i,                 // IPv6 unique local
  /^fe80:/i,              // IPv6 link-local
  /^::1$/,                // IPv6 loopback
  /^::$/,                 // unspecified
];

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFError";
  }
}

/**
 * Validates a URL is safe to fetch (no SSRF).
 * Throws SSRFError if the URL is blocked.
 * Returns the sanitised URL string on success.
 */
export function validateImageUrl(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new SSRFError("URL is required");
  }

  const trimmed = raw.trim();

  // Allow data URLs (base64 images) — they don't make network requests
  if (trimmed.startsWith("data:image/")) {
    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new SSRFError("Invalid URL format");
  }

  // Only allow http(s)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SSRFError(`Blocked scheme: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Check blocked hostnames
  if (BLOCKED_HOSTS.has(hostname)) {
    throw new SSRFError(`Blocked host: ${hostname}`);
  }

  // Check private IP patterns
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new SSRFError(`Blocked private/internal IP: ${hostname}`);
    }
  }

  // Block hostnames that resolve to suspicious patterns
  if (
    hostname.endsWith(".internal") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".localhost")
  ) {
    throw new SSRFError(`Blocked internal hostname: ${hostname}`);
  }

  return trimmed;
}
