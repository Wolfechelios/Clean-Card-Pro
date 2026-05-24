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
  set_name: string | null;
  card_number: string | null;
};

// Cards missing set_name OR card_number
const MISSING_FILTER =
  "set_name.is.null,set_name.eq.,set_name.eq.Unknown,set_name.eq.unknown,card_number.is.null,card_number.eq.";

type RequestBody = {
  batchSize?: number;
  cardIds?: string[];
  force?: boolean;
};

function toSafeCardIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((id) => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim())
    .slice(0, 200);
}

function cleanField(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (low === "unknown" || low === "null" || low === "n/a" || low === "none") return null;
  return s;
}

function parseFields(content: string): {
  set_name: string | null;
  card_number: string | null;
  card_name: string | null;
} {
  let parsed: any = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch { /* ignore */ }
    }
  }
  if (!parsed || typeof parsed !== "object") {
    return { set_name: null, card_number: null, card_name: null };
  }
  const num = cleanField(parsed.card_number ?? parsed.number);
  // Reject obviously broken numbers
  const safeNum = num && num !== "0" ? num : null;
  return {
    set_name: cleanField(parsed.set_name ?? parsed.set),
    card_number: safeNum,
    card_name: cleanField(parsed.card_name ?? parsed.name),
  };
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
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: RequestBody = await req.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(Number(body.batchSize || 12), 1), 50);
    const cardIds = toSafeCardIds(body.cardIds);
    const force = body.force === true;

    console.log(
      `bulk-set-number user=${user.id} batchSize=${batchSize} cardIds=${cardIds.length} force=${force}`
    );

    let query = supabase
      .from("cards")
      .select("id, image_url, card_name, set_name, card_number")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true });

    if (!force) query = query.or(MISSING_FILTER);
    if (cardIds.length > 0) query = query.in("id", cardIds);
    else query = query.limit(batchSize);

    const { data: cards, error: fetchError } = await query;
    if (fetchError) throw fetchError;

    if (!cards || cards.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          processed: 0,
          updated: 0,
          setUpdated: 0,
          numberUpdated: 0,
          nameUpdated: 0,
          remaining: 0,
          message: "No cards with missing set/number",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const processCard = async (card: CardRow) => {
      const result = {
        id: card.id,
        success: false,
        setUpdated: false,
        numberUpdated: false,
        nameUpdated: false,
        reason: undefined as string | undefined,
      };
      try {
        if (!card.image_url) {
          result.reason = "missing_image";
          return result;
        }

        const prompt = `You are looking at a trading card image. Identify the SET, CARD NUMBER, and CARD NAME exactly as printed on the card. Return JSON only:
{
  "set_name": "Full set name or set code as printed (e.g. 'Scarlet & Violet—Twilight Masquerade', 'SDK', 'BLB'). Null if not visible.",
  "card_number": "Number as printed including denominator if shown (e.g. '045/167', 'SDK-001', 'SV03-EN032'). Null if not visible.",
  "card_name": "Exact card name as printed. Null if not clearly readable.",
  "confidence": 0.0-1.0
}

RULES:
- Only return values you can actually read from the image. If uncertain, return null for that field.
- Preserve set codes and numbering verbatim — do not invent or normalize.
- Do not guess based on the artwork alone.

Existing card name in DB (for context only, may be wrong): ${card.card_name ?? "(none)"}
Image URL: ${card.image_url}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        async function callModel(model: string) {
          return fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: prompt }],
              temperature: 0.1,
            }),
            signal: controller.signal,
          });
        }

        let resp = await callModel("google/gemini-2.5-flash").finally(() =>
          clearTimeout(timeout)
        );

        if (!resp.ok && (resp.status === 429 || resp.status >= 500)) {
          console.warn(`Gemini failed (${resp.status}), falling back to gpt-5-mini`);
          const fbController = new AbortController();
          const fbTimeout = setTimeout(() => fbController.abort(), 20000);
          resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "openai/gpt-5-mini",
              messages: [{ role: "user", content: prompt }],
            }),
            signal: fbController.signal,
          }).finally(() => clearTimeout(fbTimeout));
        }

        if (!resp.ok) {
          result.reason = `api_error_${resp.status}`;
          return result;
        }

        const json = await resp.json();
        const content = String(json?.choices?.[0]?.message?.content ?? "");
        const fields = parseFields(content);

        const update: Record<string, string> = {};
        const missingSet = !card.set_name || ["", "unknown"].includes(card.set_name.trim().toLowerCase());
        const missingNum = !card.card_number || card.card_number.trim() === "";
        const missingName = !card.card_name || card.card_name.trim() === "";

        if (fields.set_name && (force || missingSet)) update.set_name = fields.set_name;
        if (fields.card_number && (force || missingNum)) update.card_number = fields.card_number;
        if (fields.card_name && (force || missingName)) update.card_name = fields.card_name;

        if (Object.keys(update).length === 0) {
          result.reason = "no_fields";
          return result;
        }

        const { error: updateError } = await supabase
          .from("cards")
          .update(update)
          .eq("id", card.id)
          .eq("user_id", user.id);

        if (updateError) {
          console.error("Update error:", updateError);
          result.reason = "update_error";
          return result;
        }

        result.success = true;
        result.setUpdated = !!update.set_name;
        result.numberUpdated = !!update.card_number;
        result.nameUpdated = !!update.card_name;
        return result;
      } catch (e) {
        console.error("processCard error:", e);
        result.reason = "exception";
        return result;
      }
    };

    const CONCURRENCY = 4;
    let updated = 0, setUpdated = 0, numberUpdated = 0, nameUpdated = 0;
    const results: any[] = [];

    for (let i = 0; i < cards.length; i += CONCURRENCY) {
      const chunk = cards.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(chunk.map(processCard));
      for (const r of chunkResults) {
        results.push(r);
        if (r.success) updated++;
        if (r.setUpdated) setUpdated++;
        if (r.numberUpdated) numberUpdated++;
        if (r.nameUpdated) nameUpdated++;
      }
    }

    const { count: remainingCount } = await supabase
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .or(MISSING_FILTER);

    return new Response(
      JSON.stringify({
        success: true,
        processed: cards.length,
        updated,
        setUpdated,
        numberUpdated,
        nameUpdated,
        remaining: remainingCount ?? 0,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("bulk-reanalyze-rarity (set/number) fatal:", error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
