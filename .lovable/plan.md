## Problem

The OCR engine crashes on init with:
`expected magic word 00 61 73 6d, found 3c 21 64 6f`

Hex `3c 21 64 6f` = ASCII `<!do` — the browser is receiving an HTML page (index.html fallback) where the `.wasm` binary should be.

## Root cause

When the `.mjs` ORT loader runs, it resolves the `.wasm` sibling via its own `import.meta.url` (i.e. `/ort/ort-wasm-simd-threaded.jsep.wasm`). We removed the physical wasm from `public/ort/` (too big to commit) and only externalized it via `lovable-assets`. The `wasmPaths` object mapping we set is not being honored on this code path, so the loader requests the missing local path and the dev server returns `index.html`.

## Fix

Pre-fetch the wasm bytes from the externalized asset URL and hand them directly to ONNX Runtime via `ort.env.wasm.wasmBinary`. This bypasses all path resolution — the loader uses the ArrayBuffer we provide and never issues its own fetch.

## Changes

**`src/lib/paddleOCR.ts`**
- Remove `ort.env.wasm.wasmPaths` object mapping.
- Add an async pre-fetch: `fetch(wasmAsset.url)` → `arrayBuffer()` → assign to `ort.env.wasm.wasmBinary`.
- Keep `/ort/ort-wasm-simd-threaded.jsep.mjs` served locally (small, already in repo) so the loader module still resolves.
- Cache the fetched bytes in a module-level promise so we only download once.
- Run the pre-fetch inside `initPaddleOCR()` before the first `OcrClass.create()` call.

No other files change. Public asset layout stays: `.mjs` local, `.wasm` on Lovable asset CDN.

## Verification

After the fix, the Diagnostics panel self-test should:
1. Successfully init PaddleOCR (no "magic word" error).
2. Complete an OCR round trip on a test image.

If the asset URL itself returns HTML in this environment (secondary failure), we'd see a JSON parse / non-200 error at the `fetch` step, which is easier to diagnose than the current wasm-magic error.
