// Client wrapper for the mtg-edition-finder edge function.

import { supabase } from "@/integrations/supabase/client";

export interface MtgPrinting {
  set_code: string;
  set_name: string;
  year: number | null;
  released_at: string | null;
  collector_number: string | null;
  border_color: string | null;
  frame: string | null;
  rarity: string | null;
  prices: {
    usd: number | null;
    usd_foil: number | null;
    usd_etched: number | null;
  };
  image_uri: string | null;
  is_early_set: boolean;
  early_label: string | null;
  scryfall_id: string;
}

export interface FindEditionsResult {
  success: boolean;
  printings: MtgPrinting[];
  bestMatch?: MtgPrinting | null;
  total?: number;
  error?: string;
}

export async function findMtgEditions(
  cardName: string,
  opts?: { hintYear?: number; hintSetCode?: string },
): Promise<FindEditionsResult> {
  const { data, error } = await supabase.functions.invoke("mtg-edition-finder", {
    body: {
      cardName,
      hintYear: opts?.hintYear,
      hintSetCode: opts?.hintSetCode,
    },
  });
  if (error) {
    return { success: false, printings: [], error: error.message };
  }
  return data as FindEditionsResult;
}

export async function autocompleteMtgName(query: string): Promise<string[]> {
  if (!query || query.trim().length < 2) return [];
  const { data, error } = await supabase.functions.invoke("mtg-edition-finder", {
    body: { cardName: query, autocomplete: true },
  });
  if (error || !data?.success) return [];
  return Array.isArray(data.suggestions) ? data.suggestions : [];
}

export const EARLY_MTG_SET_CODES = ["lea", "leb", "2ed", "3ed", "4ed", "5ed"] as const;

export function isEarlyMtgSetCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return (EARLY_MTG_SET_CODES as readonly string[]).includes(code.toLowerCase());
}
