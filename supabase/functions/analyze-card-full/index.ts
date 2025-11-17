// supabase/functions/analyze-card-full/index.ts
// Full chained analysis for a trading card image:
// 1) Google Vision API: OCR + crop hints + image properties
// 2) Google Gemini 2.5 Flash: condition grading estimate
// 3) Return combined payload.
//
// Env vars required:
// - GOOGLE_VISION_API_KEY
// - GEMINI_API_KEY

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

type RequestBody = {
  image_url: string;
  card_id?: string;
  game?: string;
  set_code?: string;
  card_name?: string;
};

type VisionTextAnnotation = {
  locale?: string;
  description?: string;
};

type GradeEstimate = {
  min: number;
  max: number;
  confidence: number;
};

type DefectLevel = "none" | "minor" | "moderate" | "severe";

type DefectFlags = {
  centering: DefectLevel;
  corners: DefectLevel;
  edges: DefectLevel;
  surface: DefectLevel;
  structural_damage: DefectLevel;
};

type GeminiConditionResponse = {
  raw_grade_estimate: GradeEstimate;
  condition_notes: string[];
  defect_flags: DefectFlags;
  recommended_action: string;
};

const GOOGLE_VISION_API_KEY = Deno.env.get("GOOGLE_VISION_API_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

if (!GOOGLE_VISION_API_KEY) {
  console.error("GOOGLE_VISION_API_KEY is not set.");
}

if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set.");
}

// ArrayBuffer -> Base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function callVision(imageUrl: string) {
  const visionEndpoint =
    `https://vision.googleapis.com/v1/images:annotate?key=${GOOGLE_VISION_API_KEY}`;

  const payload = {
    requests: [
      {
        image: {
          source: { imageUri: imageUrl },
        },
        features: [
          { type: "DOCUMENT_TEXT_DETECTION" },
          { type: "CROP_HINTS" },
          { type: "IMAGE_PROPERTIES" },
          { type: "LABEL_DETECTION", maxResults: 20 },
          { type: "LOGO_DETECTION", maxResults: 10 },
          { type: "WEB_DETECTION" },
        ],
        imageContext: {
          cropHintsParams: {
            aspectRatios: [0.7, 1.0],
          },
        },
      },
    ],
  };

  const res = await fetch(visionEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Vision API failed (${res.status}): ${txt}`);
  }

  const json = await res.json();
  const response = json.responses?.[0] ?? {};

  const fullText: VisionTextAnnotation | undefined =
    response.fullTextAnnotation;
  const cropHints = response.cropHintsAnnotation?.cropHints ?? [];
  const imageProps = response.imagePropertiesAnnotation ?? {};
  const labels = response.labelAnnotations ?? [];
  const logos = response.logoAnnotations ?? [];
  const webDetection = response.webDetection ?? {};

  let primaryCrop: {
    importanceFraction: number | null;
    boundingPoly: any;
  } | null = null;

  if (cropHints.length > 0) {
    const first = cropHints[0];
    primaryCrop = {
      importanceFraction: first.importanceFraction ?? null,
      boundingPoly: first.boundingPoly ?? null,
    };
  }

  // Process labels to extract card attributes
  const processedLabels = labels.map((label: any) => ({
    description: label.description,
    score: label.score,
    topicality: label.topicality,
  }));

  // Process logos
  const processedLogos = logos.map((logo: any) => ({
    description: logo.description,
    score: logo.score,
  }));

  // Process web detection for similar images and related entities
  const webEntities = webDetection.webEntities?.map((entity: any) => ({
    entityId: entity.entityId,
    description: entity.description,
    score: entity.score,
  })) ?? [];

  const similarImages = webDetection.visuallySimilarImages?.map((img: any) => img.url) ?? [];
  const matchingImages = webDetection.fullMatchingImages?.map((img: any) => img.url) ?? [];

  return {
    raw_vision_response: response,
    ocr_text: fullText?.description ?? "",
    ocr_locale: fullText?.locale ?? null,
    crop_hint: primaryCrop,
    image_properties: imageProps,
    labels: processedLabels,
    logos: processedLogos,
    web_detection: {
      entities: webEntities,
      similar_images: similarImages.slice(0, 5), // Limit to 5
      matching_images: matchingImages.slice(0, 5),
    },
  };
}

async function callGeminiForCondition(
  imageUrl: string,
  imgBuffer: ArrayBuffer,
  mimeType: string,
): Promise<GeminiConditionResponse> {
  const promptText = `
You are a professional trading card grader (PSA/BGS/CGC style).

You will receive a CLEAR photo of a SINGLE trading card.
Your job:
- Analyze only the visible card.
- Estimate a RAW grade range on a PSA 1–10 scale (no decimals).
- Be conservative if image is low quality or card is partially visible.

You MUST:
1. Consider:
   - Centering (front and back, if visible)
   - Corner wear (whitening, dings, roundness)
   - Edge wear (chipping, whitening)
   - Surface (scratches, print lines, dimples, dents, stains)
   - Structural damage (creases, bends, warps, stains)

2. If the card is in a sleeve, top loader, or has glare:
   - Mention this and lower your confidence.
   - Only grade what you can reliably see.

3. If you cannot reasonably estimate, return a wide range and low confidence.

Return ONLY valid JSON in this exact structure:
{
  "raw_grade_estimate": { "min": number, "max": number, "confidence": number },
  "condition_notes": string[],
  "defect_flags": {
    "centering": "none" | "minor" | "moderate" | "severe",
    "corners": "none" | "minor" | "moderate" | "severe",
    "edges": "none" | "minor" | "moderate" | "severe",
    "surface": "none" | "minor" | "moderate" | "severe",
    "structural_damage": "none" | "minor" | "moderate" | "severe"
  },
  "recommended_action": string
}
No extra text, no markdown, no explanation outside the JSON.
`.trim();

  const imgBase64 = arrayBufferToBase64(imgBuffer);

  const geminiEndpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  const res = await fetch(`${geminiEndpoint}?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: promptText },
            {
              inline_data: {
                mime_type: mimeType,
                data: imgBase64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
      },
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Gemini API failed (${res.status}): ${txt}`);
  }

  const json = await res.json();
  const candidates = json.candidates ?? [];
  if (!candidates.length) {
    throw new Error("Gemini returned no candidates");
  }

  const parts = candidates[0].content?.parts ?? [];
  const textPart = parts.find((p: any) => typeof p.text === "string");
  if (!textPart) {
    throw new Error("Gemini returned no text part");
  }

  let parsed: GeminiConditionResponse;
  try {
    parsed = JSON.parse(textPart.text) as GeminiConditionResponse;
  } catch (e) {
    console.error("Gemini JSON parse error:", textPart.text);
    throw new Error("Failed to parse JSON from Gemini");
  }

  return parsed;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  try {
    if (!GOOGLE_VISION_API_KEY || !GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({
          error:
            "GOOGLE_VISION_API_KEY and GEMINI_API_KEY must be configured on the server",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = (await req.json()) as RequestBody;
    const { image_url, card_id, game, set_code, card_name } = body;

    if (!image_url) {
      return new Response(
        JSON.stringify({ error: "image_url is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Step 1: Vision
    const visionResult = await callVision(image_url);

    // Step 2: Fetch image bytes
    const imgRes = await fetch(image_url);
    if (!imgRes.ok) {
      const txt = await imgRes.text().catch(() => "");
      return new Response(
        JSON.stringify({
          error: "Failed to download image for Gemini",
          status: imgRes.status,
          details: txt,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const imgBuffer = await imgRes.arrayBuffer();
    const mimeType =
      imgRes.headers.get("content-type")?.split(";")[0] || "image/jpeg";

    // Step 3: Gemini
    const geminiRaw = await callGeminiForCondition(
      image_url,
      imgBuffer,
      mimeType,
    );

    const estimate = geminiRaw.raw_grade_estimate ?? {
      min: 5,
      max: 8,
      confidence: 0.5,
    };

    const min = Math.max(1, Math.min(10, estimate.min));
    const max = Math.max(min, Math.min(10, estimate.max));
    const confidence = Math.max(0, Math.min(1, estimate.confidence));

    const defaultFlags: DefectFlags = {
      centering: "moderate",
      corners: "moderate",
      edges: "moderate",
      surface: "moderate",
      structural_damage: "none",
    };

    const condition = {
      card_id: card_id ?? null,
      game: game ?? null,
      set_code: set_code ?? null,
      card_name: card_name ?? null,
      raw_grade_estimate: { min, max, confidence },
      condition_notes: geminiRaw.condition_notes ?? [],
      defect_flags: geminiRaw.defect_flags ?? defaultFlags,
      recommended_action:
        geminiRaw.recommended_action ??
        "Use this estimate only as a rough pre-screen; not a replacement for professional grading.",
      analyzed_at: new Date().toISOString(),
    };

    const combined = {
      image_url,
      card_id: card_id ?? null,
      game: game ?? null,
      set_code: set_code ?? null,
      card_name: card_name ?? null,
      vision: {
        ocr_text: visionResult.ocr_text,
        ocr_locale: visionResult.ocr_locale,
        crop_hint: visionResult.crop_hint,
        image_properties: visionResult.image_properties,
        raw_vision_response: visionResult.raw_vision_response,
      },
      condition_estimate: condition,
    };

    return new Response(JSON.stringify(combined), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("analyze-card-full error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
