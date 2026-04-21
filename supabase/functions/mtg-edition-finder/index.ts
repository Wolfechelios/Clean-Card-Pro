// Scryfall MTG Edition Finder — returns all printings of a named card
// with prices and flags early/vintage sets (LEA/LEB/2ED/3ED/4ED/5ED).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EARLY_SETS = new Set(["lea", "leb", "2ed", "3ed", "4ed", "5ed"]);
const EARLY_LABEL: Record<string, string> = {
  lea: "Alpha",
  leb: "Beta",
  "2ed": "Unlimited",
  "3ed": "Revised",
  "4ed": "4th Edition",
  "5ed": "5th Edition",
};

interface Printing {
  set_code: string;
  set_name: string;
  year: number | null;
  released_at: string | null;
  collector_number: string | null;
  border_color: string | null;
  frame: string | null;
  rarity: string | null;
  prices: { usd: number | null; usd_foil: number | null; usd_etched: number | null };
  image_uri: string | null;
  is_early_set: boolean;
  early_label: string | null;
  scryfall_id: string;
}

function parsePrice(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { cardName, hintYear, hintSetCode, autocomplete } = await req.json();

    // Optional: autocomplete-only mode
    if (autocomplete && typeof cardName === "string" && cardName.trim().length > 0) {
      const acRes = await fetch(
        `https://api.scryfall.com/cards/autocomplete?q=${encodeURIComponent(cardName.trim())}`,
      );
      const acData = await acRes.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ success: true, suggestions: Array.isArray(acData?.data) ? acData.data : [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!cardName || typeof cardName !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "cardName is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const trimmed = cardName.trim();
    const query = `!"${trimmed}"`;
    const url =
      `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}` +
      `&unique=prints&order=released&dir=asc`;

    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) {
        return new Response(
          JSON.stringify({ success: true, printings: [], message: "No printings found" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      throw new Error(`Scryfall error: ${res.status}`);
    }

    const data = await res.json();
    const cards: any[] = Array.isArray(data?.data) ? data.data : [];

    const printings: Printing[] = cards.map((c) => {
      const setCode = String(c.set ?? "").toLowerCase();
      const isEarly = EARLY_SETS.has(setCode);
      const year = c.released_at ? parseInt(String(c.released_at).slice(0, 4)) : null;
      const image = c.image_uris?.normal ?? c.image_uris?.large ?? c.image_uris?.small ?? null;
      return {
        set_code: setCode,
        set_name: c.set_name ?? "",
        year: isNaN(year as number) ? null : year,
        released_at: c.released_at ?? null,
        collector_number: c.collector_number ?? null,
        border_color: c.border_color ?? null,
        frame: c.frame ?? null,
        rarity: c.rarity ?? null,
        prices: {
          usd: parsePrice(c.prices?.usd),
          usd_foil: parsePrice(c.prices?.usd_foil),
          usd_etched: parsePrice(c.prices?.usd_etched),
        },
        image_uri: image,
        is_early_set: isEarly,
        early_label: isEarly ? EARLY_LABEL[setCode] : null,
        scryfall_id: c.id ?? "",
      };
    });

    // Sort: early sets first, then by year ascending
    printings.sort((a, b) => {
      if (a.is_early_set !== b.is_early_set) return a.is_early_set ? -1 : 1;
      return (a.year ?? 9999) - (b.year ?? 9999);
    });

    // Optional best match
    let bestMatch: Printing | null = null;
    if (hintSetCode) {
      const code = String(hintSetCode).toLowerCase();
      bestMatch = printings.find((p) => p.set_code === code) ?? null;
    }
    if (!bestMatch && hintYear) {
      bestMatch = printings.find((p) => p.year === Number(hintYear)) ?? null;
    }

    return new Response(
      JSON.stringify({ success: true, printings, bestMatch, total: printings.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("mtg-edition-finder error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
