import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAuth } from "../_shared/requireAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function pickBest(prices: Array<number | null | undefined>): number | null {
  const vals = prices.filter((v): v is number => typeof v === "number" && v > 0);
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  // median
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const cardIds: string[] = Array.isArray(body?.cardIds) ? body.cardIds.slice(0, 25) : [];
  if (cardIds.length === 0) {
    return new Response(JSON.stringify({ error: "cardIds[] required (max 25 per call)" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: ownedCards, error: ownErr } = await supabase
    .from("cards")
    .select("id, card_name, card_set, set_name, card_number, year, player_name, sport_type, sport, game_type")
    .eq("user_id", auth.userId)
    .in("id", cardIds);

  if (ownErr) {
    return new Response(JSON.stringify({ error: ownErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<{
    id: string;
    status: "updated" | "no_match" | "error" | "skipped";
    raw?: number | null;
    psa9?: number | null;
    psa10?: number | null;
    error?: string;
  }> = [];

  for (const card of ownedCards || []) {
    const isSports = (card.game_type || "").toLowerCase() === "sports" || !!card.sport_type || !!card.sport;
    if (!isSports) {
      results.push({ id: card.id, status: "skipped", error: "Not a sports card" });
      continue;
    }
    try {
      const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sports-card-prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth.authHeader },
        body: JSON.stringify({
          cardName: card.card_name,
          cardSet: card.set_name || card.card_set,
          cardNumber: card.card_number,
          playerName: card.player_name,
          year: card.year,
          sportType: card.sport_type || card.sport,
        }),
      });

      if (resp.status === 429) {
        results.push({ id: card.id, status: "error", error: "Rate limited" });
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      if (!resp.ok) {
        results.push({ id: card.id, status: "error", error: `HTTP ${resp.status}` });
        continue;
      }

      const data = await resp.json();
      const sources = [data?.sportsCardPro, data?.cardLadder, data?.oneThirtyPoint, data?.ebay].filter(Boolean);
      const raw = pickBest(sources.map((s: any) => s?.raw));
      const psa9 = pickBest(sources.map((s: any) => s?.psa9));
      const psa10 = pickBest(sources.map((s: any) => s?.psa10));

      if (raw == null && psa9 == null && psa10 == null) {
        results.push({ id: card.id, status: "no_match" });
      } else {
        const update: Record<string, unknown> = { last_price_update: new Date().toISOString() };
        if (raw != null) update.current_price_raw = raw;
        if (psa9 != null) update.current_price_psa9 = psa9;
        if (psa10 != null) update.current_price_psa10 = psa10;
        await supabase.from("cards").update(update).eq("id", card.id).eq("user_id", auth.userId);
        results.push({ id: card.id, status: "updated", raw, psa9, psa10 });
      }
    } catch (e) {
      results.push({ id: card.id, status: "error", error: String((e as Error).message || e) });
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
