import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAuth } from "../_shared/requireAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Pull all owned cards (paginated)
  const owned: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("cards")
      .select("set_name, card_number, game_type, current_price_raw")
      .eq("user_id", auth.userId)
      .range(from, from + 999);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!data?.length) break;
    owned.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  // Reference set sizes from pc_sets
  const { data: refSets } = await supabase
    .from("pc_sets")
    .select("set_name, total_cards, game")
    .eq("user_id", auth.userId);

  const totalsBySet = new Map<string, { total: number; game: string }>();
  for (const s of refSets || []) {
    const key = (s.set_name || "").toLowerCase().trim();
    if (key) totalsBySet.set(key, { total: s.total_cards || 0, game: s.game });
  }

  const groups = new Map<string, {
    set_name: string;
    game_type: string;
    owned: number;
    unique_numbers: Set<string>;
    value: number;
    total: number | null;
  }>();

  for (const c of owned) {
    const set = (c.set_name || "").trim();
    if (!set) continue;
    const key = set.toLowerCase();
    const ref = totalsBySet.get(key);
    const g = groups.get(key) || {
      set_name: set,
      game_type: c.game_type || ref?.game || "?",
      owned: 0,
      unique_numbers: new Set<string>(),
      value: 0,
      total: ref?.total ?? null,
    };
    g.owned += 1;
    if (c.card_number) g.unique_numbers.add(String(c.card_number).toLowerCase());
    g.value += Number(c.current_price_raw || 0);
    groups.set(key, g);
  }

  const rows = Array.from(groups.values()).map((g) => ({
    set_name: g.set_name,
    game_type: g.game_type,
    owned: g.owned,
    unique: g.unique_numbers.size,
    total: g.total,
    completion_pct: g.total && g.total > 0
      ? Math.min(100, Math.round((g.unique_numbers.size / g.total) * 100))
      : null,
    value: Math.round(g.value * 100) / 100,
  })).sort((a, b) => {
    // Near-complete first when totals known
    const aComp = a.completion_pct ?? -1;
    const bComp = b.completion_pct ?? -1;
    return bComp - aComp || b.owned - a.owned;
  });

  return new Response(JSON.stringify({ sets: rows }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
