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
    const rawLines = rawText.split(/\n/).map((l: string) => l.trim()).filter(Boolean);

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

    // Extract likely card title — pick the strongest line near the top.
    const title = inferCardTitle(rawLines);

    // Match a known set name fuzzy contains against a curated dictionary.
    const setName = inferSetName(normalized);

    // Confidence scoring
    let confidence = 0;
    if (normalized.length > 5) confidence += 0.2;
    if (normalized.length > 20) confidence += 0.1;
    if (collectorNumber || cardNumber) confidence += 0.25;
    if (setCode) confidence += 0.15;
    if (title) confidence += 0.2;
    if (setName) confidence += 0.1;
    if (lines.length >= 2) confidence += 0.05;
    confidence = Math.min(confidence, 1.0);

    console.log(`[zai-ocr] OCR: title="${title ?? ""}" setName="${setName ?? ""}" setCode=${setCode} num=${cardNumber} conf=${confidence}`);

    return new Response(
      JSON.stringify({
        text: normalized,
        rawText,
        lines,
        boxes,
        title,
        name: title,
        setName,
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

// ─── Title + set name inference ─────────────────────────────────────

const TITLE_NOISE = /^(konami|pokemon|pokémon|wizards|illus\.?|©|tm|trademark|first edition|1st edition|limited edition|unlimited|common|rare|uncommon|super rare|ultra rare|secret rare|spell card|trap card|effect monster|normal monster|fusion monster|synchro monster|xyz monster|link monster|basic|stage 1|stage 2|trainer|energy|item|tool|supporter|stadium|hp\b|atk\b|def\b|level\b|cost\b|attack\b|defense\b|©.*|pokemon company|the pokémon company|nintendo|creatures|game freak|mtg|magic the gathering|topps|panini|upper deck|fleer|donruss|bowman|score)/i;

function inferCardTitle(lines: string[]): string | null {
  if (!lines.length) return null;
  const candidates = lines
    .map((line) => line.replace(/[#*_`]/g, "").trim())
    .filter((line) => line.length >= 3 && line.length <= 60)
    .filter((line) => !TITLE_NOISE.test(line))
    .filter((line) => /[a-zA-Z]/.test(line))
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !/^\d+\/\d+$/.test(line))
    .filter((line) => !/^[A-Z]{2,5}-[A-Z]{0,3}\d{1,5}$/.test(line));

  if (!candidates.length) return null;

  const scored = candidates.map((line, idx) => {
    let score = 0;
    // Prefer earlier lines (titles are typically near top of card)
    score += Math.max(0, 10 - idx);
    // Prefer Title Case / proper noun shapes
    if (/^[A-Z][A-Za-z'’\- ]+$/.test(line)) score += 4;
    if (/^[A-Z][A-Z'’\- ]+$/.test(line) && line.length <= 30) score += 3;
    // Penalize lines that look like rules text / sentences
    if (/\.$/.test(line)) score -= 2;
    if (line.split(/\s+/).length > 6) score -= 2;
    if (/\$|€|£/.test(line)) score -= 5;
    return { line, score };
  }).sort((a, b) => b.score - a.score);

  return scored[0]?.line ?? null;
}

const KNOWN_SETS: Array<{ name: string; aliases: string[] }> = [
  // Pokémon
  { name: "Base Set", aliases: ["base set"] },
  { name: "Jungle", aliases: ["jungle"] },
  { name: "Fossil", aliases: ["fossil"] },
  { name: "Team Rocket", aliases: ["team rocket"] },
  { name: "Neo Genesis", aliases: ["neo genesis"] },
  { name: "Scarlet & Violet", aliases: ["scarlet & violet", "scarlet and violet", "scarlet violet"] },
  { name: "Paldea Evolved", aliases: ["paldea evolved"] },
  { name: "Obsidian Flames", aliases: ["obsidian flames"] },
  { name: "Paradox Rift", aliases: ["paradox rift"] },
  { name: "Temporal Forces", aliases: ["temporal forces"] },
  { name: "Twilight Masquerade", aliases: ["twilight masquerade"] },
  { name: "Stellar Crown", aliases: ["stellar crown"] },
  { name: "Surging Sparks", aliases: ["surging sparks"] },
  { name: "Prismatic Evolutions", aliases: ["prismatic evolutions"] },
  { name: "151", aliases: ["pokemon 151", "151"] },
  { name: "Crown Zenith", aliases: ["crown zenith"] },
  { name: "Silver Tempest", aliases: ["silver tempest"] },
  { name: "Lost Origin", aliases: ["lost origin"] },
  { name: "Astral Radiance", aliases: ["astral radiance"] },
  { name: "Brilliant Stars", aliases: ["brilliant stars"] },
  { name: "Fusion Strike", aliases: ["fusion strike"] },
  { name: "Evolving Skies", aliases: ["evolving skies"] },
  { name: "Chilling Reign", aliases: ["chilling reign"] },
  { name: "Battle Styles", aliases: ["battle styles"] },
  { name: "Vivid Voltage", aliases: ["vivid voltage"] },
  { name: "Champion's Path", aliases: ["champion's path", "champions path"] },
  { name: "Hidden Fates", aliases: ["hidden fates"] },
  { name: "Shining Fates", aliases: ["shining fates"] },
  // Yu-Gi-Oh!
  { name: "Legend of Blue Eyes White Dragon", aliases: ["legend of blue eyes", "lob"] },
  { name: "Metal Raiders", aliases: ["metal raiders", "mrd"] },
  { name: "Magic Ruler", aliases: ["magic ruler", "mrl"] },
  { name: "Pharaoh's Servant", aliases: ["pharaoh's servant", "psv"] },
  { name: "Invasion of Chaos", aliases: ["invasion of chaos", "ioc"] },
  { name: "Legendary Collection", aliases: ["legendary collection"] },
  { name: "25th Anniversary", aliases: ["25th anniversary"] },
  // MTG
  { name: "Alpha", aliases: ["limited edition alpha"] },
  { name: "Beta", aliases: ["limited edition beta"] },
  { name: "Modern Horizons 3", aliases: ["modern horizons 3"] },
  { name: "The Lord of the Rings", aliases: ["lord of the rings", "tales of middle-earth"] },
  { name: "Bloomburrow", aliases: ["bloomburrow"] },
  { name: "Duskmourn", aliases: ["duskmourn"] },
  { name: "Foundations", aliases: ["foundations"] },
];

function inferSetName(text: string): string | null {
  const haystack = text.toLowerCase();
  for (const entry of KNOWN_SETS) {
    for (const alias of entry.aliases) {
      if (haystack.includes(alias)) return entry.name;
    }
  }
  return null;
}

