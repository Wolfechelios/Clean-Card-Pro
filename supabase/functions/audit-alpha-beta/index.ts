import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireAuth } from "../_shared/requireAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Candidate {
  id: string;
  card_name: string;
  card_set: string | null;
  set_name: string | null;
  year: number | null;
  current_price_raw: number | null;
  image_url: string | null;
  game_type: string | null;
  confidence: number;
  reasons: string[];
  guess: string;
}

const GAME_TYPE_MAP: Record<string, string[]> = {
  mtg: ["MTG", "Magic", "Magic: The Gathering", "mtg", "magic"],
  pokemon: ["Pokemon", "Pokémon", "pokemon", "pokémon"],
  yugioh: ["YuGiOh", "Yu-Gi-Oh", "yugioh", "yu-gi-oh", "Yugioh"],
  sports: ["Sports", "sports"],
};

const ALPHA_KW = ["alpha", "limited edition alpha", "lea"];
const BETA_KW = ["beta", "limited edition beta", "leb"];
const UNLIMITED_KW = ["unlimited"];
const EARLY_EXPANSION_KW = ["arabian nights", "antiquities", "legends", "the dark", "fallen empires"];
const OLD_BORDER_KW = [
  "revised", "3rd edition", "third edition",
  "4th edition", "fourth edition",
  "5th edition", "fifth edition",
  "ice age", "homelands", "alliances",
  "mirage", "visions", "weatherlight",
  "tempest", "stronghold", "exodus",
  "urza's saga", "urza's legacy", "urza's destiny",
];

const POKEMON_VINTAGE_SETS = ["base set", "jungle", "fossil", "team rocket", "gym heroes", "gym challenge", "neo genesis", "neo discovery", "neo destiny"];
const YGO_VINTAGE_SETS = ["legend of blue eyes", "lob", "metal raiders", "mrd", "magic ruler", "mrl", "spell ruler", "srl", "pharaoh's servant", "psv"];

function scoreMtg(card: any): Candidate | null {
  const reasons: string[] = [];
  let confidence = 0;
  let guess = "Vintage MTG";
  const setStr = `${card.set_name || ""} ${card.card_set || ""}`.toLowerCase();
  const editionStr = (card.edition || "").toLowerCase();
  const all = `${setStr} ${editionStr}`;

  if (ALPHA_KW.some((k) => all.includes(k))) {
    confidence += 80; reasons.push("Set matches Alpha"); guess = "Alpha";
  } else if (BETA_KW.some((k) => all.includes(k))) {
    confidence += 80; reasons.push("Set matches Beta"); guess = "Beta";
  } else if (UNLIMITED_KW.some((k) => all.includes(k))) {
    confidence += 60; reasons.push("Unlimited Edition"); guess = "Unlimited";
  } else if (EARLY_EXPANSION_KW.some((k) => all.includes(k))) {
    confidence += 70; reasons.push("Early expansion (1993–94)"); guess = "Early Expansion";
  } else if (OLD_BORDER_KW.some((k) => all.includes(k))) {
    confidence += 50; reasons.push("Old-border set"); guess = "Old-Border MTG";
  }

  if (card.year) {
    if (card.year <= 1995) { confidence += 30; reasons.push(`Year ${card.year}`); }
    else if (card.year <= 1999) { confidence += 15; reasons.push(`Year ${card.year}`); }
  }

  if (confidence < 30) return null;
  return baseCandidate(card, confidence, reasons, guess);
}

function scorePokemon(card: any): Candidate | null {
  const reasons: string[] = [];
  let confidence = 0;
  let guess = "Vintage Pokémon";
  const setStr = `${card.set_name || ""} ${card.card_set || ""}`.toLowerCase();
  const editionStr = (card.edition || "").toLowerCase();

  if (editionStr.includes("1st") || editionStr.includes("first edition")) {
    confidence += 60; reasons.push("1st Edition marked"); guess = "1st Edition Pokémon";
  }
  if (setStr.includes("shadowless") || editionStr.includes("shadowless")) {
    confidence += 70; reasons.push("Shadowless"); guess = "Shadowless Base Set";
  }
  if (POKEMON_VINTAGE_SETS.some((s) => setStr.includes(s))) {
    confidence += 40; reasons.push(`Vintage WOTC set`);
  }
  if (card.year && card.year >= 1998 && card.year <= 2003) {
    confidence += 30; reasons.push(`WOTC era (${card.year})`);
  }
  if (confidence <= 0) return null;
  return baseCandidate(card, confidence, reasons, guess);
}

function scoreYugioh(card: any): Candidate | null {
  const reasons: string[] = [];
  let confidence = 0;
  let guess = "Vintage Yu-Gi-Oh";
  const setStr = `${card.set_name || ""} ${card.card_set || ""}`.toLowerCase();
  const editionStr = (card.edition || "").toLowerCase();

  if (editionStr.includes("1st")) { confidence += 50; reasons.push("1st Edition"); guess = "1st Edition YGO"; }
  if (YGO_VINTAGE_SETS.some((s) => setStr.includes(s))) {
    confidence += 50; reasons.push("Early TCG set");
  }
  if (card.year && card.year >= 2002 && card.year <= 2004) {
    confidence += 30; reasons.push(`Early YGO era (${card.year})`);
  }
  if (confidence <= 0) return null;
  return baseCandidate(card, confidence, reasons, guess);
}

function scoreSports(card: any): Candidate | null {
  const reasons: string[] = [];
  let confidence = 0;
  let guess = "Vintage Sports Card";
  if (!card.year) return null;
  if (card.year < 1980) { confidence += 70; reasons.push(`Pre-1980 (${card.year})`); }
  else if (card.year < 1990) { confidence += 40; reasons.push(`1980s (${card.year})`); }
  if (confidence <= 0) return null;
  return baseCandidate(card, confidence, reasons, guess);
}

function baseCandidate(card: any, confidence: number, reasons: string[], guess: string): Candidate {
  return {
    id: card.id, card_name: card.card_name, card_set: card.card_set, set_name: card.set_name,
    year: card.year, current_price_raw: card.current_price_raw, image_url: card.image_url,
    game_type: card.game_type, confidence: Math.min(100, confidence), reasons, guess,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireAuth(req, corsHeaders);
  if (auth instanceof Response) return auth;

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }
  const game: string = (body?.game || "all").toString().toLowerCase();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const all: any[] = [];
  let from = 0;
  const PAGE = 1000;
  const acceptedTypes = GAME_TYPE_MAP[game];
  while (true) {
    let q = supabase
      .from("cards")
      .select("id, card_name, card_set, set_name, edition, year, current_price_raw, image_url, game_type, sport_type")
      .eq("user_id", auth.userId)
      .range(from, from + PAGE - 1);
    if (acceptedTypes && game !== "sports") q = q.in("game_type", acceptedTypes);
    else if (game === "sports") q = q.or(`game_type.in.(${acceptedTypes!.join(",")}),sport_type.not.is.null`);
    const { data, error } = await q;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const candidates: Candidate[] = [];
  for (const card of all) {
    const gt = (card.game_type || "").toLowerCase();
    let c: Candidate | null = null;
    if (gt === "mtg" || gt === "magic" || gt === "magic: the gathering") c = scoreMtg(card);
    else if (gt === "pokemon" || gt === "pokémon") c = scorePokemon(card);
    else if (gt === "yugioh" || gt === "yu-gi-oh") c = scoreYugioh(card);
    else if (gt === "sports" || card.sport_type) c = scoreSports(card);
    if (c) candidates.push(c);
  }
  candidates.sort((a, b) => b.confidence - a.confidence);

  return new Response(
    JSON.stringify({ totalScanned: all.length, candidates }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
