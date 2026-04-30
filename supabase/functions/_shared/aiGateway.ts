// Shared helper for calling Lovable AI Gateway with automatic
// Gemini → OpenAI fallback on rate-limit (429) or server errors (5xx).
//
// Usage:
//   import { callAIGateway } from "../_shared/aiGateway.ts";
//   const resp = await callAIGateway({ messages, response_format: { type: "json_object" } });
//
// Defaults to google/gemini-2.5-flash. Falls back to openai/gpt-5-mini.

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export interface AIGatewayBody {
  messages: any[];
  model?: string;
  fallbackModel?: string;
  temperature?: number;
  max_tokens?: number;
  response_format?: any;
  tools?: any[];
  tool_choice?: any;
  reasoning?: any;
  [key: string]: any;
}

export interface AIGatewayOptions {
  apiKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Calls the Lovable AI Gateway with primary model, falls back automatically
 * on 429 (rate limit) or 5xx (server error). 402 (credits exhausted) is NOT
 * retried — surfaced immediately so callers can show payment UI.
 */
export async function callAIGateway(
  body: AIGatewayBody,
  options: AIGatewayOptions = {}
): Promise<Response> {
  const apiKey = options.apiKey ?? Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const primaryModel = body.model ?? "google/gemini-2.5-flash";
  const fallbackModel = body.fallbackModel ?? "openai/gpt-5-mini";
  const timeoutMs = options.timeoutMs ?? 30_000;

  const { fallbackModel: _fb, ...payload } = body;

  async function call(model: string): Promise<Response> {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (options.signal) {
      if (options.signal.aborted) ac.abort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      return await fetch(GATEWAY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...payload, model }),
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener("abort", onAbort);
    }
  }

  let resp: Response;
  try {
    resp = await call(primaryModel);
  } catch (err) {
    console.warn(`[aiGateway] ${primaryModel} threw, trying ${fallbackModel}:`, err);
    return await call(fallbackModel);
  }

  // Don't retry 402 (credits) or 4xx other than 429
  if (resp.ok || resp.status === 402) return resp;
  if (resp.status !== 429 && resp.status < 500) return resp;

  console.warn(
    `[aiGateway] ${primaryModel} returned ${resp.status}, falling back to ${fallbackModel}`
  );
  // Drain primary body so connection can close cleanly
  try { await resp.text(); } catch { /* ignore */ }
  return await call(fallbackModel);
}
