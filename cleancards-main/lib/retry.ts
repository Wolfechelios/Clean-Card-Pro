// src/lib/retry.ts

export type RetryOptions = {
  retries?: number
  baseMs?: number
  maxMs?: number
  shouldRetry?: (err: any) => boolean
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const retries = opts.retries ?? 4
  const baseMs = opts.baseMs ?? 600
  const maxMs = opts.maxMs ?? 8000

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      const msg = String(err?.message ?? err)
      const retryable =
        opts.shouldRetry?.(err) ??
        /429|rate limit|too many|timeout|network|502|503|504/i.test(msg)

      if (!retryable || attempt === retries) {
        throw err
      }

      const delay = Math.min(maxMs, baseMs * Math.pow(2, attempt))
      await new Promise((r) => setTimeout(r, delay))
    }
  }

  throw new Error("Retry loop exhausted")
}
