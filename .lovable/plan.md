

## Plan: Add Z.AI OCR as a Server-Side Pipeline Stage

### Overview

Add Z.AI's `glm-ocr` model as a focused OCR pre-processing step in the card identification pipeline. It runs server-side via a new edge function, called on cropped title/metadata regions before the main AI identification pass. This gives higher-quality OCR text to the identification model, reducing misidentifications (the root cause of repeated same-name results).

### Architecture

```text
Capture image
  │
  ▼
Upload to storage
  │
  ▼
NEW: Edge function "zai-ocr" — crops title + bottom metadata,
     calls Z.AI layout_parsing, returns structured text + confidence
  │
  ▼
Pass OCR text into rapid-card-identify / enhanced-card-identify
  │
  ▼
If confidence still low → existing multimodal AI fallback
  │
  ▼
Price lookup → save
```

### Changes

**1. Store Z.AI API key as a secret**
- Use `add_secret` tool to request `ZAI_API_KEY` from user
- Key is used only server-side in the edge function

**2. New edge function `supabase/functions/zai-ocr/index.ts`**
- Accepts `{ imageUrl, mode: "title" | "meta" | "full" }`
- Fetches the image, converts to base64
- Calls `https://api.z.ai/api/paas/v4/layout_parsing` with `model: "glm-ocr"`
- Extracts text from `md_results`, layout boxes from `layout_details`
- Normalizes OCR text (collapse whitespace, fix common misreads like `|` → `I`)
- Extracts structured fields via regex: collector number (`\d{1,3}/\d{1,3}`), set code (`[A-Z]{2,5}-[A-Z]{0,2}\d{3}`)
- Returns `{ text, lines, boxes, collectorNumber, setCode, confidence, requestId }`

**3. Update `src/lib/queueProcessor.ts` — processJob()**
- After upload, before `hybridIdentifyCard`, call `supabase.functions.invoke("zai-ocr", { body: { imageUrl, mode: "meta" } })`
- If Z.AI returns a collector number + set code with high confidence, skip the expensive multimodal AI call entirely and go straight to DB matching + pricing
- If Z.AI returns partial text, pass it as `ocrText` to `hybridIdentifyCard` to boost the AI's accuracy
- If Z.AI fails or returns empty, proceed with the existing flow (no regression)

**4. Update `src/lib/hybridCardIdentify.ts`**
- Already accepts `ocrText` parameter and passes it to cloud functions — no change needed

**5. Update `supabase/functions/rapid-card-identify/index.ts`**
- Already accepts `ocrText` in request body and includes it in the AI prompt — no change needed

### Confidence-based routing logic (in queueProcessor)

```text
Z.AI OCR result:
  ├─ collectorNumber + setCode found → DB lookup directly (skip AI) → confidence = "strong"
  ├─ partial text (name visible, no number) → pass ocrText to hybridIdentifyCard → confidence = "medium"
  └─ empty / error → proceed with existing flow unchanged → confidence = "none"
```

### Files

| File | Action |
|------|--------|
| `supabase/functions/zai-ocr/index.ts` | Create — Z.AI OCR proxy with text normalization |
| `src/lib/queueProcessor.ts` | Edit — call zai-ocr before identification, use structured results for direct DB match |

### What stays unchanged
All existing scanning, pricing, camera, microscope, anomaly detection, premium set highlighting, and UI functionality remains intact. The Z.AI OCR is additive — if it fails, the existing pipeline runs unmodified.

### Prerequisites
- User must provide `ZAI_API_KEY` secret before the edge function can work

