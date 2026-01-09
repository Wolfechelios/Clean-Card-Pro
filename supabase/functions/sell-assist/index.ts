// supabase/functions/sell-assist/index.ts
// AI "Sell Assist": platform + method + pricing strategy + ready-to-post listing copy.
// Uses Lovable AI gateway (Gemini) — same pattern as other AI functions.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

type RequestBody = {
  goal?: "fast" | "max";
  condition?: "raw" | "graded";
  risk?: "low" | "medium" | "high";
  card: {
    id: string;
    name: string;
    set?: string | null;
    number?: string | null;
    rarity?: string | null;
    game?: string | null;
    current_price_raw?: number | null;
    psa10_price?: number | null;
    cgc10_price?: number | null;
    condition_label?: string | null;
  };
};

type SellAssistResult = {
  platform: string;
  reason: string;
  sellMethod: string;
  timing: string;
  pricing: {
    fast: { price: number; eta: string };
    market: { price: number; eta: string };
    max: { price: number; eta: string };
  };
  listing: {
    title: string;
    description: string;
  };
  note: string;
};

function clampPrice(n: unknown, fallback: number): number {
  const v = typeof n === "number" && isFinite(n) ? n : fallback;
  return Math.max(0, Math.round(v * 100) / 100);
}

function heuristicFallback(body: RequestBody): SellAssistResult {
  const raw = body.card.current_price_raw ?? null;
  const base = typeof raw === "number" && isFinite(raw) && raw > 0 ? raw : 49.99;

  const fast = clampPrice(base * 0.9, base);
  const market = clampPrice(base, base);
  const max = clampPrice(base * 1.15, base);

  const platform = body.card.game?.toLowerCase().includes("pokemon") || body.card.game?.toLowerCase().includes("mtg") || body.card.game?.toLowerCase().includes("yug")
    ? "TCGplayer"
    : "eBay";

  const title = [body.card.name, body.card.set, body.card.number].filter(Boolean).join(" ").slice(0, 80);

  return {
    platform,
    reason: "Fallback recommendation (AI unavailable). Based on typical buyer volume + fees.",
    sellMethod: body.goal === "fast" ? "Buy It Now + Offers (price to move)" : "Buy It Now + Offers (hold firm)" ,
    timing: "Sell now unless you’re waiting on grading or a known hype event.",
    pricing: {
      fast: { price: fast, eta: "1–3 days" },
      market: { price: market, eta: "5–10 days" },
      max: { price: max, eta: "2–4 weeks" },
    },
    listing: {
      title: title || "Card Listing",
      description:
        "Clean listing description:\n\n" +
        "• Card: " + (body.card.name || "Unknown") + "\n" +
        "• Set: " + (body.card.set || "Unknown") + "\n" +
        "• Condition: " + (body.card.condition_label || "See photos") + "\n\n" +
        "Stored safely. Ships fast, protected. Please review photos for exact condition.",
    },
    note: "Tip: Strong photos + honest condition language sells faster than hype words.",
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();

    if (!body?.card?.id || !body?.card?.name) {
      return new Response(JSON.stringify({ error: "Missing card" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      // Don’t hard fail: return a deterministic fallback so the feature still works.
      const fallback = heuristicFallback(body);
      return new Response(JSON.stringify(fallback), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const goal = body.goal ?? "max";
    const condition = body.condition ?? "raw";
    const risk = body.risk ?? "medium";

    const prompt = `You are a professional trading-card resale strategist. Your goal is to maximize seller profit while minimizing risk and wasted time.

You are given a single card and limited market context.

CARD:
- Name: ${body.card.name}
- Set: ${body.card.set ?? ""}
- Number: ${body.card.number ?? ""}
- Rarity: ${body.card.rarity ?? ""}
- Game/Sport: ${body.card.game ?? ""}
- Condition label: ${body.card.condition_label ?? ""}
- Raw price (if known): ${body.card.current_price_raw ?? ""}
- PSA 10 price (if known): ${body.card.psa10_price ?? ""}
- CGC 10 price (if known): ${body.card.cgc10_price ?? ""}

SELLER PREFERENCES:
- Goal: ${goal === "fast" ? "Fast money" : "Max profit"}
- Condition mode: ${condition}
- Risk tolerance: ${risk}

OUTPUT RULES:
- Return ONLY valid JSON.
- Be realistic. No fake claims. No grade guarantees.
- Keep it actionable and concise.

Return JSON in this exact shape:
{
  "platform": "eBay|TCGplayer|Whatnot|Facebook|Local shop|HOLD",
  "reason": "one short paragraph",
  "sellMethod": "one line",
  "timing": "one line",
  "pricing": {
    "fast": { "price": 0, "eta": "" },
    "market": { "price": 0, "eta": "" },
    "max": { "price": 0, "eta": "" }
  },
  "listing": {
    "title": "<= 80 chars when possible",
    "description": "platform-optimized, honest, no hype, includes shipping/condition disclaimer"
  },
  "note": "one short practical tip or warning"
}`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiResponse.ok) {
      const t = await aiResponse.text();
      console.error("sell-assist AI error", aiResponse.status, t);
      const fallback = heuristicFallback(body);
      return new Response(JSON.stringify(fallback), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiResult = await aiResponse.json();
    const content = aiResult.choices?.[0]?.message?.content;
    if (!content) {
      const fallback = heuristicFallback(body);
      return new Response(JSON.stringify(fallback), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed: SellAssistResult;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("sell-assist parse fail", content);
      const fallback = heuristicFallback(body);
      return new Response(JSON.stringify(fallback), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Basic hardening: ensure numbers are sane.
    const base = typeof body.card.current_price_raw === "number" && isFinite(body.card.current_price_raw)
      ? body.card.current_price_raw
      : 49.99;

    parsed.pricing = {
      fast: {
        price: clampPrice(parsed?.pricing?.fast?.price, base * 0.9),
        eta: parsed?.pricing?.fast?.eta || "1–3 days",
      },
      market: {
        price: clampPrice(parsed?.pricing?.market?.price, base),
        eta: parsed?.pricing?.market?.eta || "5–10 days",
      },
      max: {
        price: clampPrice(parsed?.pricing?.max?.price, base * 1.15),
        eta: parsed?.pricing?.max?.eta || "2–4 weeks",
      },
    };

    parsed.listing = {
      title: (parsed?.listing?.title || "").toString().slice(0, 120),
      description: (parsed?.listing?.description || "").toString(),
    };

    parsed.platform = (parsed?.platform || "eBay").toString();
    parsed.reason = (parsed?.reason || "").toString();
    parsed.sellMethod = (parsed?.sellMethod || "").toString();
    parsed.timing = (parsed?.timing || "").toString();
    parsed.note = (parsed?.note || "").toString();

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("sell-assist error", e);
    return new Response(JSON.stringify({ error: "sell-assist failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
