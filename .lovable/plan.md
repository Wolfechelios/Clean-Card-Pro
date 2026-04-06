

## Plan: Remove Jetson Orin / Local Accelerator Features

### What's being removed
All code related to the Jetson Orin inference server and the broader "Local Accelerator" (GPU offload) system — the WebSocket streaming client, HTTP client, settings, availability checker, and all UI for configuring/connecting to a local GPU server.

### Files to delete

| File/Directory | Reason |
|---|---|
| `jetson-inference-server/` (entire directory) | Jetson server code |
| `mac-inference-server/` (entire directory) | Mac inference server code |
| `src/lib/gpuOffload/` (entire directory) | All GPU offload client code (WS, HTTP, settings, availability, types, frameEncoder) |
| `src/hooks/use-gpu-offload-stream.ts` | GPU streaming React hook |
| `src/lib/performance/gpuConfig.ts` | GPU config constants |

### Files to edit

| File | Changes |
|---|---|
| `src/hooks/use-scanner-settings.ts` | Remove `GpuServerType` type, all `gpu*` fields from `ScannerSettings` and `DEFAULT_SETTINGS` |
| `src/pages/SettingsPage.tsx` | Remove the entire "Local Accelerator" settings section (~200 lines) |
| `src/components/scanner/RapidScanCamera.tsx` | Remove GPU stream hook, frame encoder, auto-connect/disconnect effects, streaming loop, and accelerator status overlay |
| `src/hooks/use-card-scanner.ts` | Remove GPU availability check and GPU identify/OCR fallback paths |
| `src/lib/hybridCardIdentify.ts` | Remove GPU server identify path and `identifyWithGpuServer` function; keep cloud + offline paths |
| `src/lib/queueProcessor.ts` | Remove any GPU-prefer logic from the worker loop |

### What stays
- All cloud-based OCR/identification (edge functions, Z.AI)
- Offline/local OCR (PaddleOCR, ONNX)
- All other scanner features (camera, rapid scan, batch, microscope, remote)

