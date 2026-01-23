// src/lib/onDeviceLLM.ts
// Experimental on-device inference scaffolding.
//
// Reality check: full vision-based card identification on-device is non-trivial.
// This file provides a clean seam to plug in a WebGPU/WASM model later
// (e.g., transformers.js, ONNX Runtime Web, or llama.cpp WASM).

export type OnDeviceIdentifyResult = {
  name: string;
  set?: string;
  number?: string;
  confidence?: number; // 0-1
};

let initialized = false;

export async function initOnDeviceLLM() {
  if (initialized) return;
  // Placeholder for model loading.
  // Recommended approach:
  //  - host model artifacts under /public/models/... (or use a CDN you control)
  //  - lazy-load only when feature flag is enabled
  //  - prefer WebGPU backend when available
  initialized = true;
}

export async function identifyCardOnDevice(_jpegBlob: Blob): Promise<OnDeviceIdentifyResult | null> {
  await initOnDeviceLLM();

  // TODO: implement actual inference.
  // For now, return null to fall back to server-side pipeline.
  return null;
}
