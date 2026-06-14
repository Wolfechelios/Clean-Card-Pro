// src/lib/async/withTimeout.ts
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Wrap a promise with a timeout.
 * Works even if underlying API doesn't support AbortSignal.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  let t: any;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new TimeoutError(label ? `${label} timed out` : "Operation timed out")), ms);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(t)) as Promise<T>;
}
