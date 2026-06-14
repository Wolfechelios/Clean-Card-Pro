import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAuth } from "../_shared/requireAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TCG_GAMES = new Set(["yugioh", "yu-gi-oh", "mtg", "magic", "pokemon", "pokémon"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body OK */ }
  const cardIds: string[] = Array.isArray(body?.cardIds) ? body.cardIds.slice(0, 50) : [];
  if (cardIds.length === 0) {
    return new Response(JSON.stringify({ error: "cardIds[] required (max 50 per call)" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: ownedCards, error: ownErr } = await supabase
    .from("cards")
    .select("id, card_name, card_set, set_name, card_number, year, game_type")
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
    game_type?: string | null;
    set_name?: string | null;
    card_number?: string | null;
    market?: number | null;
    error?: string;
  }> = [];

  // Run cards in parallel with a small concurrency cap and a tiny throttle between waves.
  // This is what changed: previously serial with a 1500ms sleep per card
  // (~17s per 10-card batch even before the price API responds). Now ~4 in flight.
  const CONCURRENCY = 4;
  const THROTTLE_BETWEEN_WAVES_MS = 200;

  async function processOne(card: any) {
    const gtRaw = (card.game_type || "").toLowerCase().replace(/[^a-z]/g, "");
    let gt = "";
    if (["yugioh"].includes(gtRaw)) gt = "yugioh";
    else if (["mtg", "magic"].includes(gtRaw)) gt = "mtg";
    else if (["pokemon", "pokmon"].includes(gtRaw)) gt = "pokemon";
    else if (!gtRaw) gt = "yugioh";
    if (!gt || !TCG_GAMES.has(gt)) {
      return { id: card.id, status: "skipped" as const, game_type: card.game_type, error: "Not a TCG (use Sports tab)" };
    }
    try {
      const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/fetch-card-prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth.authHeader },
        body: JSON.stringify({
          cardName: card.card_name,
          cardSet: card.set_name || card.card_set,
          cardNumber: card.card_number,
          gameType: gt,
        }),
      });

      if (resp.status === 429) {
        return { id: card.id, status: "error" as const, error: "Rate limited" };
      }
      if (!resp.ok) {
        return { id: card.id, status: "error" as const, error: `HTTP ${resp.status}` };
      }

      const data = await resp.json();
      const market: number | null =
        data?.tcgPlayerMarket ?? data?.tcgPlayerMid ?? data?.tcgPlayerPrice ?? data?.raw ?? null;

      if (market == null) {
        return { id: card.id, status: "no_match" as const, game_type: card.game_type };
      }
      await supabase.from("cards").update({
        current_price_raw: market,
        last_price_update: new Date().toISOString(),
      }).eq("id", card.id).eq("user_id", auth.userId);
      return {
        id: card.id, status: "updated" as const, game_type: card.game_type,
        set_name: card.set_name, card_number: card.card_number, market,
      };
    } catch (e) {
      return { id: card.id, status: "error" as const, error: String((e as Error).message || e) };
    }
  }

  const queue = [...(ownedCards || [])];
  while (queue.length > 0) {
    const wave = queue.splice(0, CONCURRENCY);
    const waveResults = await Promise.all(wave.map(processOne));
    results.push(...waveResults);
    if (queue.length > 0) await new Promise((r) => setTimeout(r, THROTTLE_BETWEEN_WAVES_MS));
  }

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
