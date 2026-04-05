import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { validateImageUrl, SSRFError } from "../_shared/validateUrl.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl: rawImageUrl, mode = "meta" } = await req.json();

    let imageUrl: string;
    try {
      imageUrl = validateImageUrl(rawImageUrl);
    } catch (e) {
      if (e instanceof SSRFError) {
        return new Response(JSON.stringify({ error: e.message, text: "", confidence: 0 }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(
        JSON.stringify({ error: "imageUrl is required", text: "", confidence: 0 }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ZAI_API_KEY = Deno.env.get('ZAI_API_KEY');
    if (!ZAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "ZAI_API_KEY not configured", text: "", confidence: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch image and convert to base64
    const imageBase64 = await fetchImageAsBase64(imageUrl);
    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch image", text: "", confidence: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[zai-ocr] Calling Z.AI layout_parsing (mode: ${mode})...`);

    const resp = await fetch("https://api.z.ai/api/paas/v4/layout_parsing", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ZAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "glm-ocr",
        file: `data:image/jpeg;base64,${imageBase64}`,
        return_crop_images: false,
        need_layout_visualization: false,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[zai-ocr] Z.AI error ${resp.status}: ${errText}`);
      return new Response(
        JSON.stringify({ error: `Z.AI OCR failed: ${resp.status}`, text: "", confidence: 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await resp.json();

    const rawText = (data.md_results || "").trim();
    const boxes = data.layout_details || [];

    // Normalize OCR text
    const normalized = rawText
      .replace(/\s+/g, " ")
      .replace(/[|]/g, "I")
      .replace(/[`]/g, "'")
      .trim();

    const lines = normalized.split(/\n/).map((l: string) => l.trim()).filter(Boolean);

    // Extract structured fields via regex
    // Collector number patterns: 4/102, 023/165, SV049/SV122
    const collectorMatch = normalized.match(/\b(\d{1,4})\s*[\/]\s*(\d{1,4})\b/) ||
      normalized.match(/\b(SV\d{1,4})\s*[\/]\s*(SV\d{1,4})\b/i);
    const collectorNumber = collectorMatch ? collectorMatch[0].replace(/\s/g, "") : null;

    // Set code patterns: LOB-EN001, STOR-EN045, BT01-042, SM12-123, etc.
    const setCodeMatch = normalized.match(/\b([A-Z]{2,5}[-]?[A-Z]{0,3}\d{1,3})\b/) ||
      normalized.match(/\b([A-Z]{2,5}-[A-Z]{2}\d{3})\b/);
    const setCode = setCodeMatch ? setCodeMatch[1] : null;

    // YGO full card number: LOB-EN001, IOC-EN025, etc.
    const ygoCardNumber = normalized.match(/\b([A-Z]{2,5}-[A-Z]{2}\d{3})\b/);
    const cardNumber = ygoCardNumber ? ygoCardNumber[1] : collectorNumber;

    // Confidence scoring
    let confidence = 0;
    if (normalized.length > 5) confidence += 0.3;
    if (normalized.length > 20) confidence += 0.1;
    if (collectorNumber || cardNumber) confidence += 0.3;
    if (setCode) confidence += 0.2;
    if (lines.length >= 2) confidence += 0.1;
    confidence = Math.min(confidence, 1.0);

    console.log(`[zai-ocr] OCR result: ${normalized.substring(0, 80)}... | confidence: ${confidence} | setCode: ${setCode} | cardNumber: ${cardNumber}`);

    return new Response(
      JSON.stringify({
        text: normalized,
        rawText,
        lines,
        boxes,
        collectorNumber,
        setCode,
        cardNumber,
        confidence,
        requestId: data.request_id ?? null,
        usage: data.usage ?? null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error("[zai-ocr] Error:", error);
    return new Response(
      JSON.stringify({ error: String(error), text: "", confidence: 0 }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  } catch {
    return null;
  }
}
