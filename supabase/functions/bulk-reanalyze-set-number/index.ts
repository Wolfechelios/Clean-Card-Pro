import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type CardRow = {
  id: string;
  image_url: string | null;
  card_name: string | null;
  card_set: string | null;
  card_number: string | null;
  rarity: string | null;
  game_type: string | null;
};

type SetNumberResult = {
  confirmedCardName?: string | null;
  confirmedSetName?: string | null;
  confirmedSetCode?: string | null;
  confirmedCardNumber?: string | null;
  confirmedRarity?: string | null;
  confirmedVariant?: string | null;
  confidence?: number;
  evidence?: string[];
  changedFields?: string[];
  warningFlags?: string[];
};

type RequestBody = {
  batchSize?: number;
  cardIds?: string[];
};

const SUSPECT_SET_NUMBER_FILTER =
  "card_set.is.null,card_set.eq.,card_number.is.null,card_number.eq.";

function toSafeCardIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((id) => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim())
    .slice(0, 200);
}

function asConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? Math.max(0, Math.min(100, n)) : Math.max(0, Math.min(100, n * 100));
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const low = text.toLowerCase();
  if (low === "unknown" || low === "null" || low === "n/a") return null;
  return text;
}

function parseResult(content: string): SetNumberResult | null {
  let parsed: any = null;

  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  return {
    confirmedCardName: cleanString(parsed.confirmedCardName),
    confirmedSetName: cleanString(parsed.confirmedSetName),
    confirmedSetCode: cleanString(parsed.confirmedSetCode),
    confirmedCardNumber: cleanString(parsed.confirmedCardNumber),
    confirmedRarity: cleanString(parsed.confirmedRarity),
    confirmedVariant: cleanString(parsed.confirmedVariant),
    confidence: asConfidence(parsed.confidence),
    evidence: Array.isArray(parsed.evidence)
      ? parsed.evidence.map((v: unknown) => String(v)).slice(0, 8)
      : [],
    changedFields: Array.isArray(parsed.changedFields)
      ? parsed.changedFields.map((v: unknown) => String(v)).slice(0, 12)
      : [],
    warningFlags: Array.isArray(parsed.warningFlags)
      ? parsed.warningFlags.map((v: unknown) => String(v)).slice(0, 12)
      : [],
  };
}

function buildPatch(card: CardRow, result: SetNumberResult) {
  const patch: Record<string, string> = {};
  const changedFields: string[] = [];

  const setName = cleanString(result.confirmedSetName);
  const number = cleanString(result.confirmedCardNumber);
  const rarity = cleanString(result.confirmedRarity);

  if (setName && setName !== card.card_set) {
    patch.card_set = setName;
    changedFields.push("card_set");
  }

  if (number && number !== card.card_number) {
    patch.card_number = number;
    changedFields.push("card_number");
  }

  if (rarity && (!card.rarity || ["unknown", "null"].includes(card.rarity.toLowerCase()))) {
    patch.rarity = rarity;
    changedFields.push("rarity");
  }

  return { patch, changedFields };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: RequestBody = await req.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(Number(body.batchSize || 10), 1), 40);
    const cardIds = toSafeCardIds(body.cardIds);

    let query = supabase
      .from("cards")
      .select("id, image_url, card_name, card_set, card_number, rarity, game_type", { count: "exact" })
      .eq("user_id", user.id)
      .or(SUSPECT_SET_NUMBER_FILTER)
      .order("created_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true });

    if (cardIds.length > 0) {
      query = query.in("id", cardIds);
    } else {
      query = query.limit(batchSize);
    }

    const { data: cards, error: fetchError } = await query;
    if (fetchError) throw fetchError;

    if (!cards || cards.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, updated: 0, reviewOnly: 0, results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const results: any[] = [];
    let updated = 0;
    let reviewOnly = 0;

    const processCard = async (card: CardRow) => {
      try {
        if (!card.card_name || !card.image_url) {
          reviewOnly++;
          return { id: card.id, success: false, reason: "missing_name_or_image" };
        }

        const prompt = `You are rechecking trading-card SET IDENTITY and COLLECTOR/CARD NUMBER only. Return JSON only. Do not rewrite the whole card unless evidence is strong.\n\nCurrent saved data:\n- card name: ${card.card_name}\n- set name: ${card.card_set || "missing"}\n- collector/card number: ${card.card_number || "missing"}\n- rarity: ${card.rarity || "missing"}\n- game/type: ${card.game_type || "unknown"}\n- image URL: ${card.image_url}\n\nReturn this exact JSON shape:\n{\n  "confirmedCardName": "string or null",\n  "confirmedSetName": "string or null",\n  "confirmedSetCode": "string or null",\n  "confirmedCardNumber": "string or null",\n  "confirmedRarity": "string or null",\n  "confirmedVariant": "foil/non-foil/reverse holo/first edition/unlimited/promo/alternate art/borderless/showcase/serialized/alpha/beta/etc or null",\n  "confidence": 0-100,\n  "evidence": ["short evidence statements"],\n  "changedFields": ["card_set", "card_number", "rarity", "variant"],\n  "warningFlags": ["multiple_possible_sets", "same_artwork_reprint", "promo_ambiguity", "foil_mismatch", "ocr_unreadable_number", "card_number_not_visible", "game_type_mismatch"]\n}\n\nRules:\n- Prioritize visible collector number, set logo/code, copyright year, language, border, promo marks, first-edition stamps, foil/reverse-holo clues, and known official database conventions.\n- Confidence 90-100 means safe to update set/number.\n- Confidence 70-89 means possible match but should be reviewed.\n- Below 70 means warning only.\n- If multiple sets use the same art, use warningFlags and lower confidence.\n- If the card number is not visible, return null for confirmedCardNumber and add card_number_not_visible.`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 22000);

        const resp = await fetch("https://api.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.15,
          }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));

        if (!resp.ok) {
          const apiError = await resp.text();
          console.error("Lovable Set/# API error:", apiError);
          reviewOnly++;
          return { id: card.id, success: false, reason: `api_error_${resp.status}` };
        }

        const json = await resp.json();
        const content = String(json?.choices?.[0]?.message?.content ?? "");
        const parsed = parseResult(content);

        if (!parsed) {
          reviewOnly++;
          return { id: card.id, success: false, reason: "parse_failed" };
        }

        const confidence = Number(parsed.confidence || 0);
        const unsafeWarnings = new Set([
          "multiple_possible_sets",
          "same_artwork_reprint",
          "promo_ambiguity",
          "ocr_unreadable_number",
          "card_number_not_visible",
          "game_type_mismatch",
        ]);
        const hasUnsafeWarning = (parsed.warningFlags || []).some((flag) => unsafeWarnings.has(flag));
        const { patch, changedFields } = buildPatch(card, parsed);

        if (confidence >= 90 && !hasUnsafeWarning && Object.keys(patch).length > 0) {
          const { error: updateError } = await supabase
            .from("cards")
            .update(patch)
            .eq("id", card.id)
            .eq("user_id", user.id);

          if (updateError) throw updateError;
          updated++;
          return { id: card.id, success: true, applied: true, confidence, changedFields, patch, evidence: parsed.evidence, warningFlags: parsed.warningFlags };
        }

        reviewOnly++;
        return { id: card.id, success: true, applied: false, confidence, suggested: parsed, reason: "manual_review_required" };
      } catch (error) {
        console.error("process set/# card error:", error);
        reviewOnly++;
        return { id: card.id, success: false, reason: "exception" };
      }
    };

    const CONCURRENCY = 3;
    for (let i = 0; i < cards.length; i += CONCURRENCY) {
      const chunk = cards.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(chunk.map(processCard));
      results.push(...chunkResults);
    }

    const { count: remainingCount } = await supabase
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .or(SUSPECT_SET_NUMBER_FILTER);

    return new Response(
      JSON.stringify({
        success: true,
        processed: cards.length,
        updated,
        reviewOnly,
        remaining: remainingCount ?? 0,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("bulk-reanalyze-set-number fatal:", error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
