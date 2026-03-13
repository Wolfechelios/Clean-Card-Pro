// src/lib/jetsonClient.ts
// Typed client for all Jetson inference endpoints.
// The Jetson handles ONLY vision compute — no DB, pricing, or business logic.

import { getScannerSettings } from "@/hooks/use-scanner-settings";

// ────────────────────── helpers ──────────────────────

function getBase(): string {
  const s = getScannerSettings();
  const ip = s.orinServerUrl || "192.168.1.37";
  const base = ip.startsWith("http") ? ip : `http://${ip}`;
  return base.includes(":8") ? base : `${base}:8000`;
}

function getTimeout(): number {
  return getScannerSettings().orinTimeoutMs || 15_000;
}

async function postFile(path: string, blob: Blob, timeoutMs?: number): Promise<any> {
  const fd = new FormData();
  fd.append("file", blob, "frame.jpg");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs ?? getTimeout());
  const url = `${getBase()}${path}`;
  console.log(`[Jetson] POST ${url}`);
  const res = await fetch(url, { method: "POST", body: fd, signal: ctrl.signal });
  clearTimeout(t);
  if (!res.ok) throw new Error(`Jetson ${path} → ${res.status}`);
  return res.json();
}

// ────────────────────── 1. Health ──────────────────────

export interface JetsonHealth {
  status: string;
  gpu: string;
  model_loaded: boolean;
  latency_ms: number;
}

export async function jetsonHealth(timeoutMs = 3_000): Promise<JetsonHealth> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const res = await fetch(`${getBase()}/health`, { signal: ctrl.signal });
  clearTimeout(t);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

// ────────────────────── 2. Infer ──────────────────────

export interface JetsonDetection {
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
}

export interface JetsonInferResult {
  detections: JetsonDetection[];
  ocr: { name: string; set: string } | null;
  latency_ms: number;
}

export async function jetsonInfer(imageBlob: Blob): Promise<JetsonInferResult> {
  return postFile("/infer", imageBlob);
}

// ────────────────────── 3. OCR ──────────────────────

export interface JetsonOcrResult {
  text: string;
  confidence: number;
}

export async function jetsonOcr(imageBlob: Blob): Promise<JetsonOcrResult> {
  return postFile("/ocr", imageBlob);
}

// ────────────────────── 4. Rectify ──────────────────────

export interface JetsonRectifyResult {
  corrected_image: string; // base64
  corners: [number, number][];
}

export async function jetsonRectify(imageBlob: Blob): Promise<JetsonRectifyResult> {
  return postFile("/rectify", imageBlob);
}

// ────────────────────── 5. Embedding ──────────────────────

export interface JetsonEmbeddingResult {
  vector: number[];
}

export async function jetsonEmbedding(imageBlob: Blob): Promise<JetsonEmbeddingResult> {
  return postFile("/embedding", imageBlob);
}

// ────────────────────── 6. Stream (WS) ──────────────────────

export type StreamCallback = (result: JetsonInferResult) => void;

export function jetsonStream(onResult: StreamCallback): { close: () => void } {
  const base = getBase().replace(/^http/, "ws");
  const ws = new WebSocket(`${base}/stream`);

  ws.onmessage = (e) => {
    try {
      const data: JetsonInferResult = JSON.parse(e.data);
      onResult(data);
    } catch {
      console.warn("[Jetson WS] bad message", e.data);
    }
  };

  ws.onerror = (e) => console.error("[Jetson WS] error", e);
  ws.onclose = () => console.log("[Jetson WS] closed");

  return {
    close: () => ws.close(),
  };
}
