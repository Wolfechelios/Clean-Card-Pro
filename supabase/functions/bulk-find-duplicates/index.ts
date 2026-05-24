import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAuth } from "../_shared/requireAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normName(s: string | null): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function normKey(parts: Array<string | null | undefined>): string {
  return parts.map((p) => (p || "").toString().toLowerCase().trim()).join("|");
}

interface Group {
  key: string;
  card_name: string;
  set_name: string | null;
  card_number: string | null;
  finish: string | null;
  count: number;
  total_quantity: number;
  est_value: number;
  ids: string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Paginated fetch (1000 row limit)
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("cards")
      .select("id, card_name, set_name, card_number, finish, quantity, current_price_raw, image_url, created_at")
      .eq("user_id", auth.userId)
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  const groups = new Map<string, Group>();
  for (const c of all) {
    const name = normName(c.card_name);
    if (!name) continue;
    const key = normKey([name, c.set_name, c.card_number, c.finish]);
    const g = groups.get(key);
    const qty = Number(c.quantity || 1);
    const val = Number(c.current_price_raw || 0) * qty;
    if (g) {
      g.count += 1;
      g.total_quantity += qty;
      g.est_value += val;
      g.ids.push(c.id);
    } else {
      groups.set(key, {
        key,
        card_name: c.card_name,
        set_name: c.set_name,
        card_number: c.card_number,
        finish: c.finish,
        count: 1,
        total_quantity: qty,
        est_value: val,
        ids: [c.id],
      });
    }
  }

  const dupes = Array.from(groups.values())
    .filter((g) => g.count > 1)
    .sort((a, b) => b.est_value - a.est_value);

  return new Response(JSON.stringify({
    total_cards: all.length,
    duplicate_groups: dupes.length,
    duplicate_rows: dupes.reduce((s, g) => s + (g.count - 1), 0),
    groups: dupes.slice(0, 500),
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
