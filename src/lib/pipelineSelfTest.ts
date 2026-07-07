// src/lib/pipelineSelfTest.ts
// End-to-end health probe. Does NOT touch the user's real queue or write any card.
// Each check returns { stage, ok, ms, error } so the diagnostic panel can render green/red.

import { supabase } from "@/integrations/supabase/client";

export type SelfTestStep = {
  stage: string;
  ok: boolean;
  ms: number;
  detail?: string;
  error?: string;
};

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; ms: number; error?: string }> {
  const start = performance.now();
  try {
    const value = await fn();
    return { value, ms: Math.round(performance.now() - start) };
  } catch (e: any) {
    return { ms: Math.round(performance.now() - start), error: e?.message || String(e) };
  }
}

/** Tiny 1x1 JPEG blob so OCR/lookup modules can be dynamically loaded and invoked. */
function tinyFixtureBlob(): Blob {
  // 1x1 white JPEG
  const b64 =
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AH//Z";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}

export async function runPipelineSelfTest(): Promise<SelfTestStep[]> {
  const steps: SelfTestStep[] = [];

  // 1. Browser environment
  {
    const t = await timed(async () => {
      if (typeof indexedDB === "undefined") throw new Error("IndexedDB unavailable");
      if (typeof crypto === "undefined") throw new Error("crypto unavailable");
      return true;
    });
    steps.push({
      stage: "environment",
      ok: !t.error,
      ms: t.ms,
      error: t.error,
      detail: "IndexedDB + crypto available",
    });
  }

  // 2. IndexedDB queue reachable
  {
    const t = await timed(async () => {
      const { idbCount } = await import("@/lib/idbQueue");
      return await idbCount();
    });
    steps.push({
      stage: "queue-db",
      ok: !t.error,
      ms: t.ms,
      error: t.error,
      detail: t.value != null ? `${t.value} items in local queue` : undefined,
    });
  }

  // 3. OCR module loads + runs (may return no text on 1x1 fixture, but load must succeed)
  {
    const t = await timed(async () => {
      const { runLocalCardOcr } = await import("@/lib/ocr/localCardOcr");
      const res = await runLocalCardOcr(tinyFixtureBlob());
      return res;
    });
    steps.push({
      stage: "ocr-engine",
      ok: !t.error,
      ms: t.ms,
      error: t.error,
      detail: t.value ? `engine responded (confidence=${(t.value as any)?.confidence ?? "n/a"})` : undefined,
    });
  }

  // 4. Identify + pricing lookup module reachable
  {
    const t = await timed(async () => {
      const mod = await import("@/lib/rapidBasicLookupClient");
      if (typeof mod.runRapidBasicLookup !== "function") throw new Error("lookup client missing");
      return true;
    });
    steps.push({
      stage: "identify-lookup",
      ok: !t.error,
      ms: t.ms,
      error: t.error,
      detail: "runRapidBasicLookup loaded",
    });
  }

  // 5. Pricing adapters reachable
  {
    const t = await timed(async () => {
      const mod = await import("@/lib/fetchCardPrices");
      if (!mod) throw new Error("pricing module missing");
      return true;
    });
    steps.push({
      stage: "pricing-adapters",
      ok: !t.error,
      ms: t.ms,
      error: t.error,
      detail: "fetchCardPrices loaded",
    });
  }

  // 6. Backend auth session
  {
    const t = await timed(async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session?.user?.id ?? null;
    });
    steps.push({
      stage: "auth-session",
      ok: !t.error,
      ms: t.ms,
      error: t.error,
      detail: t.value ? "signed in" : "no active session (local-only saves)",
    });
  }

  // 7. Backend read (cards table ping)
  {
    const t = await timed(async () => {
      const { error } = await supabase.from("cards").select("id", { count: "exact", head: true }).limit(1);
      if (error) throw error;
      return true;
    });
    steps.push({
      stage: "backend-read",
      ok: !t.error,
      ms: t.ms,
      error: t.error,
      detail: "cards table reachable",
    });
  }

  return steps;
}
