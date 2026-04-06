

## Plan: Speed Up Rapid Scan Card Recognition

### Root cause analysis

Each card goes through **4 sequential network calls**, each with generous timeouts and retries. On a typical scan, total per-card time is 8–20 seconds:

```text
Current pipeline (serial):
  Upload to Storage ──► Z.AI OCR ──► rapid-card-identify ──► Price fetch
       ~2s                ~5s              ~5s                   ~2s
                                    (includes officialNameResolver
                                     which makes ANOTHER external API call)
```

### Optimizations (5 changes)

**1. Parallelize OCR + Identification (biggest win)**
Currently Z.AI OCR runs first (8s timeout), then its output feeds into `rapid-card-identify`. The OCR text is helpful but not required — the AI model already reads the card image. Run both in parallel; if OCR finishes first, great, otherwise the AI identifies without it.

**2. Make official name resolution async / non-blocking**
Inside `rapid-card-identify`, `resolveOfficialCardIdentity` makes external HTTP calls to ygoprodeck, pokemontcg.io, or scryfall APIs. This adds 1–5s per card. Move this to a post-processing step that enriches the result after returning the initial identification.

**3. Reduce edge function timeouts and retries**
- `invokeEdgeFunction` default timeout: 6s → 10s (one call, fewer retries)
- `rapid-card-identify` Lovable AI retries: 5 → 2 (with shorter backoff)
- Z.AI OCR timeout: 8s → 4s (it's supplementary, not critical)

**4. Upload + Identify in parallel**
Currently the image is uploaded to Storage, then the public URL is used for identification. Instead, start the upload and identification concurrently — the AI can use a base64 data URL while the storage upload proceeds in the background.

**5. Switch to faster AI model for rapid mode**
Already using `gemini-2.5-flash-lite` which is the fastest. Reduce `max_tokens` from 300 → 200 (JSON response is ~150 tokens). Add `response_format: { type: "json_object" }` to skip markdown wrapping.

### Expected improvement

```text
Optimized pipeline (parallel):
  ┌─ Upload to Storage ─────────┐
  ├─ Z.AI OCR (4s cap) ─────────┤──► Merge ──► Price fetch
  └─ rapid-card-identify (no    │       ~0s        ~2s
     name resolver) ────────────┘
           ~3-5s total

Before: ~14s per card
After:  ~5-7s per card
```

### Files to edit

| File | Changes |
|------|---------|
| `src/lib/queueProcessor.ts` | Parallelize upload + OCR + identify; pass base64 to identify; make name resolution a background enrichment step |
| `supabase/functions/rapid-card-identify/index.ts` | Remove `resolveOfficialCardIdentity` call (move to post-process); reduce retries 5→2; reduce max_tokens 300→200; add `response_format` |
| `src/lib/hybridCardIdentify.ts` | Reduce cloud retry count from 2→1; tighten timeout |

### What stays unchanged
- Card identification accuracy (same AI model and prompt)
- Offline fallback logic
- Anomaly detection
- Price fetching (already parallelized with ownership check)
- All scanner UI components

