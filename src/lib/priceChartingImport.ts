import * as ExcelJS from "exceljs";
import { Database } from "@/types/supabase";
import { Card } from "@/types";
import { supabase } from "@/integrations/supabase/client";

// ── Types ──────────────────────────────────────────────────────────
export interface PCRawRow {
  index?: number;
  set_name?: string;
  card_name?: string;
  card_number?: string;
  variant?: string;
  ungraded_price?: number;
  graded_price?: number;
  grade9_price?: number;
  psa10_price?: number;
  card_url?: string;
  source_url?: string;
}

export interface ParsedSet {
  game: string;
  set_code: string | null;
  set_name: string;
  set_name_raw: string;
  source_url: string | null;
  cards: ParsedCard[];
}

export interface ParsedCard {
  card_name: string;
  card_name_clean: string;
  card_number: string | null;
  variant: string | null;
  ungraded_price: number | null;
  graded_price: number | null;
  grade9_price: number | null;
  psa10_price: number | null;
  card_url: string | null;
}

function extractSetCode(cardNumber: string | null, setNameRaw: string | null): string | null {
  if (cardNumber) {
    const m = cardNumber.match(/^([A-Z0-9]+-?[A-Z]*?\d*)-/i);
    if (m) {
      const raw = cardNumber.split("-")[0];
      if (raw && /[A-Z]/i.test(raw)) return raw.toUpperCase();
    }
  }
  if (setNameRaw) {
    const pipeSegments = setNameRaw.split("|");
    if (pipeSegments.length >= 2) {
      const codeSegment = pipeSegments[1].trim();
      const parts = codeSegment.split(/\s+/);
      const last = parts[parts.length - 1];
      if (last && /^[A-Z0-9]{2,10}$/i.test(last)) return last.toUpperCase();
    }
  }
  return null;
}

function extractSetName(setNameRaw: string): string {
  const first = setNameRaw.split("|")[0].trim();
  let clean = first
    .replace(/\s*Price Guide\s*/i, "")
    .replace(/^YuGiOh\s+/i, "")
    .replace(/^Yu-Gi-Oh!?\s+/i, "")
    .replace(/^Pokemon\s+/i, "")
    .replace(/^Magic:?\s*The Gathering\s+/i, "")
    .trim();
  return clean || first;
}

function detectGame(setNameRaw: string): string {
  const lower = setNameRaw.toLowerCase();
  if (lower.includes("yugioh") || lower.includes("yu-gi-oh")) return "yugioh";
  if (lower.includes("pokemon") || lower.includes("pokémon")) return "pokemon";
  if (lower.includes("magic") || lower.includes("mtg")) return "mtg";
  return "other";
}

function cleanCardName(rawName: string, cardNumber: string | null): string {
  let name = rawName;
  if (cardNumber) {
    const escaped = cardNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    name = name.replace(new RegExp(`\\s*${escaped}\\s*$`, "i"), "");
  }
  name = name.replace(/\s*\[.*?\]\s*/g, " ");
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

function cleanVariant(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^\[/, "").replace(/\]$/, "").trim();
  return cleaned || null;
}

export async function parseXLSXFile(data: ArrayBuffer): Promise<ParsedSet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headerRow = ws.getRow(1).values as any[];
  const headers = headerRow.slice(1).map(v => String(v ?? "").trim());
  const rows: PCRawRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = row.values as any[];
    const obj: any = {};
    let hasAny = false;
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i];
      const val = values[i + 1];
      const norm = val instanceof Date ? val.toISOString() : val;
      if (norm !== undefined && String(norm).trim() !== "") hasAny = true;
      obj[key] = norm;
    }
    if (hasAny) rows.push(obj as PCRawRow);
  });

  if (rows.length === 0) return [];

  const setMap = new Map<string, { raw: PCRawRow; setNameRaw: string }[]>();
  for (const row of rows) {
    const setNameRaw = row.set_name || "";
    const setCode = extractSetCode(row.card_number || null, setNameRaw);
    const key = setCode || extractSetName(setNameRaw);
    if (!setMap.has(key)) setMap.set(key, []);
    setMap.get(key)!.push({ raw: row, setNameRaw });
  }

  const results: ParsedSet[] = [];
  for (const [, entries] of setMap) {
    const firstEntry = entries[0];
    const setNameRaw = firstEntry.setNameRaw;
    const game = detectGame(setNameRaw);
    const set_code = extractSetCode(entries[0].raw.card_number || null, setNameRaw);
    const set_name = extractSetName(setNameRaw);
    const source_url = entries[0].raw.source_url || null;
    const cards: ParsedCard[] = entries.map(({ raw }) => ({
      card_name: raw.card_name || "Unknown",
      card_name_clean: cleanCardName(raw.card_name || "", raw.card_number || null),
      card_number: raw.card_number || null,
      variant: cleanVariant(raw.variant),
      ungraded_price: raw.ungraded_price ?? null,
      graded_price: raw.graded_price ?? null,
      grade9_price: raw.grade9_price ?? null,
      psa10_price: raw.psa10_price ?? null,
      card_url: raw.card_url || null,
    }));
    results.push({ game, set_code, set_name, set_name_raw: setNameRaw, source_url, cards });
  }
  return results;
}

export async function importParsedSets(userId: string, sets: ParsedSet[]): Promise<Card[]> {
  const cardsToInsert: Omit<Database["public"]["Tables"]["cards"]["Insert"], "id">[] = [];
  for (const set of sets) {
    for (const card of set.cards) {
      cardsToInsert.push({
        user_id: userId,
        card_name: card.card_name,
        card_set: set.set_name,
        card_number: card.card_number,
        rarity: null,
        condition: "ungraded",
        current_price_raw: card.ungraded_price,
        current_price_psa9: card.grade9_price,
        current_price_psa10: card.psa10_price,
        collection_name: set.set_name,
        game_type: set.game,
        image_url: card.card_url || null,
      });
    }
  }
  const { data, error } = await supabase.from("cards").insert(cardsToInsert).select("*");
  if (error) {
    console.error("Error importing cards", error);
    throw error;
  }
  return data || [];
}

export async function matchCardLocally(cardName: string, cardSet: string | null, gameType: string | null): Promise<Card | null> {
  if (!cardName) return null;
  const cardNameClean = cardName.replace(/[^a-zA-Z0-9\s]/g, "").trim().toLowerCase();
  const cardSetNameClean = cardSet?.replace(/[^a-zA-Z0-9\s]/g, "").trim().toLowerCase() || null;
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .ilike("card_name", cardNameClean)
    .eq("card_set", cardSet)
    .eq("game_type", gameType)
    .limit(1);
  if (error) {
    console.error("Error matching card locally", error);
    return null;
  }
  return data?.[0] || null;
}

export async function toMatch(cardName: string): Promise<Card[]> {
  if (!cardName) return [];
  const cardNameClean = cardName.replace(/[^a-zA-Z0-9\s]/g, "").trim().toLowerCase();
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .ilike("card_name", cardNameClean)
    .limit(5);
  if (error) {
    console.error("Error matching card locally", error);
    return [];
  }
  return data || [];
}

export async function getSetCompletion(userId: string, cardSet: string): Promise<{ total: number; owned: number }> {
  const { data: all, error: errAll } = await supabase
    .from("cards")
    .select("id", { count: "exact" })
    .eq("card_set", cardSet);
  const { data: owned, error: errOwned } = await supabase
    .from("cards")
    .select("id", { count: "exact" })
    .eq("user_id", userId)
    .eq("card_set", cardSet);
  if (errAll || errOwned) {
    console.error("Error getting set completion", errAll, errOwned);
    return { total: 0, owned: 0 };
  }
  return { total: all?.[0]?.count || 0, owned: owned?.[0]?.count || 0 };
}
