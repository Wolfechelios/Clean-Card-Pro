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

function isMissingRarity(rarity: unknown) {
  const r = String(rarity ?? "").trim();
  if (!r) return true;
  const low = r.toLowerCase();
  return low === "unknown" || low === "null";
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

    const { batchSize = 10, offset = 0 } = await req.json().catch(() => ({}));
    console.log(
      `Fetching cards with missing rarity for user ${user.id}, offset=${offset}, batchSize=${batchSize}`
    );

    // ✅ Only fetch cards that are actually missing rarity
    // Covers: NULL, empty string, 'Unknown'/'unknown'
    const { data: cards, error: fetchError, count } = await supabase
      .from("cards")
      .select("id, image_url, card_name, rarity", { count: "exact" })
      .eq("user_id", user.id)
      .or("rarity.is.null,rarity.eq.,rarity.eq.Unknown,rarity.eq.unknown")
      .range(offset, offset + batchSize - 1);

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

    console.log(
      `Found ${cards.length} cards to process (missing rarity). Total missing: ${count ?? "?"}`
    );

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // --- AI rarity detect (same behavior you already had) ---
    const results: { id: string; rarity: string | null; success: boolean }[] =
      [];

    const processCard = async (card: CardRow) => {
      try {
        if (!card.image_url || !card.card_name) {
          return { id: card.id, rarity: null, success: false };
        }

        const prompt = `Identify the RARITY of this trading card. Return JSON only:
{
  "rarity": "REQUIRED - Common/Uncommon/Rare/Holo Rare/Ultra Rare/Secret Rare/Rookie Card/RC/Refractor/Prizm/Parallel/Base/Super Rare/Mythic Rare/etc",
  "confidence": 0.0-1.0
}

RARITY RULES:
- Pokemon: Circle=Common, Diamond=Uncommon, Star=Rare, Star H=Holo Rare, Rainbow/Full Art=Secret Rare
- Yu-Gi-Oh: Check name color (silver=Rare, gold=Ultra Rare), holo pattern (Super/Secret/Ultimate/Ghost/Starlight)
- Sports: Base, RC (Rookie Card), Refractor, Prizm, Mosaic, Parallel, Numbered, etc.

Card Name: ${card.card_name}
Image URL: ${card.image_url}`;

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
        });

        if (!resp.ok) {
          console.error("Lovable API error:", await resp.text());
          return { id: card.id, rarity: null, success: false };
        }

        const json = await resp.json();
        const content = json?.choices?.[0]?.message?.content ?? "";

        let parsed: any = null;
        try {
          parsed = JSON.parse(content);
        } catch {
          // best-effort: try to extract JSON block
          const match = content.match(/\{[\s\S]*\}/);
          if (match) {
            try {
              parsed = JSON.parse(match[0]);
            } catch {}
          }
        }

        const rarity = String(parsed?.rarity ?? "").trim();
        if (!rarity || rarity.toLowerCase() === "unknown" || rarity.toLowerCase() === "null") {
          return { id: card.id, rarity: null, success: false };
        }

        // ✅ Update only the card that needs it (and still belongs to this user)
        const { error: updateError } = await supabase
          .from("cards")
          .update({ rarity })
          .eq("id", card.id)
          .eq("user_id", user.id);

        if (updateError) {
          console.error("Update error:", updateError);
          return { id: card.id, rarity: null, success: false };
        }

        return { id: card.id, rarity, success: true };
      } catch (e) {
        console.error("processCard error:", e);
        return { id: card.id, rarity: null, success: false };
      }
    };

    // Concurrency limit
    const CONCURRENCY = 3;
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

    // ✅ Correct remaining calculation
    const remaining = Math.max(
      0,
      (count || 0) - (offset + processed)
    );

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        updated,
        remaining,
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