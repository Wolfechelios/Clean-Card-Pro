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
  rarity: string | null;
};

const MISSING_RARITY_FILTER =
  "rarity.is.null,rarity.eq.,rarity.eq.Unknown,rarity.eq.unknown,rarity.eq.NULL,rarity.eq.null";

type RequestBody = {
  batchSize?: number;
  cardIds?: string[];
};

function toSafeCardIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((id) => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim())
    .slice(0, 200);
}

function parseRarity(content: string): string | null {
  let parsed: any = null;

  try {
    parsed = JSON.parse(content);
  } catch {
    // Best effort: extract first JSON-like block
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  const rarity = String(parsed?.rarity ?? "").trim();
  if (!rarity) return null;

  const low = rarity.toLowerCase();
  if (low === "unknown" || low === "null") return null;

  return rarity;
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

    // Get user from token
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
    const batchSize = Math.min(Math.max(Number(body.batchSize || 12), 1), 50);
    const cardIds = toSafeCardIds(body.cardIds);

    console.log(
      `bulk-reanalyze-rarity user=${user.id} batchSize=${batchSize} cardIds=${cardIds.length}`
    );

    let query = supabase
      .from("cards")
      .select("id, image_url, card_name, rarity", { count: "exact" })
      .eq("user_id", user.id)
      .or(MISSING_RARITY_FILTER)
      .order("created_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true });

    if (cardIds.length > 0) {
      query = query.in("id", cardIds);
    } else {
      query = query.limit(batchSize);
    }

    const { data: cards, error: fetchError } = await query;

    if (fetchError) {
      console.error("Fetch error:", fetchError);
      throw fetchError;
    }

    if (!cards || cards.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          processed: 0,
          updated: 0,
          remaining: 0,
          message: "No cards with missing rarity found",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const results: {
      id: string;
      rarity: string | null;
      success: boolean;
      reason?: string;
    }[] = [];

    const processCard = async (card: CardRow) => {
      try {
        if (!card.image_url || !card.card_name) {
          return {
            id: card.id,
            rarity: null,
            success: false,
            reason: "missing_image_or_name",
          };
        }

        const prompt = `Identify the RARITY of this trading card. Return JSON only:\n{\n  "rarity": "REQUIRED - Common/Uncommon/Rare/Holo Rare/Ultra Rare/Secret Rare/Rookie Card/RC/Refractor/Prizm/Parallel/Base/Super Rare/Mythic Rare/etc",\n  "confidence": 0.0-1.0\n}\n\nRARITY RULES:\n- Pokemon: Circle=Common, Diamond=Uncommon, Star=Rare, Star H=Holo Rare, Rainbow/Full Art=Secret Rare\n- Yu-Gi-Oh: Check name color (silver=Rare, gold=Ultra Rare), holo pattern (Super/Secret/Ultimate/Ghost/Starlight)\n- Sports: Base, RC (Rookie Card), Refractor, Prizm, Mosaic, Parallel, Numbered, etc.\n\nCard Name: ${card.card_name}\nImage URL: ${card.image_url}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        const resp = await fetch("https://api.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.2,
          }),
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));

        if (!resp.ok) {
          const apiError = await resp.text();
          console.error("Lovable API error:", apiError);
          return {
            id: card.id,
            rarity: null,
            success: false,
            reason: `api_error_${resp.status}`,
          };
        }

        const json = await resp.json();
        const content = String(json?.choices?.[0]?.message?.content ?? "");
        const rarity = parseRarity(content);

        if (!rarity) {
          return { id: card.id, rarity: null, success: false, reason: "no_rarity" };
        }

        const { error: updateError } = await supabase
          .from("cards")
          .update({ rarity })
          .eq("id", card.id)
          .eq("user_id", user.id)
          .or(MISSING_RARITY_FILTER);

        if (updateError) {
          console.error("Update error:", updateError);
          return {
            id: card.id,
            rarity: null,
            success: false,
            reason: "update_error",
          };
        }

        return { id: card.id, rarity, success: true };
      } catch (e) {
        console.error("processCard error:", e);
        return { id: card.id, rarity: null, success: false, reason: "exception" };
      }
    };

    // Higher throughput without hammering API too hard
    const CONCURRENCY = 4;
    let updated = 0;

    for (let i = 0; i < cards.length; i += CONCURRENCY) {
      const chunk = cards.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(chunk.map(processCard));

      for (const r of chunkResults) {
        results.push(r);
        if (r.success) updated++;
      }
    }

    const processed = cards.length;

    // True remaining count after this batch completes
    const { count: remainingCount } = await supabase
      .from("cards")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .or(MISSING_RARITY_FILTER);

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        updated,
        remaining: remainingCount ?? 0,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("bulk-reanalyze-rarity fatal:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
