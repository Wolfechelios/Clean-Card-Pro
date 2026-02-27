import * as ExcelJS from "exceljs";
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

// ── Helpers ────────────────────────────────────────────────────────

/** Extract set code from card_number like "SDJ-001" → "SDJ", or from set_name "Yu-Gi-Oh SDJ" */
function extractSetCode(cardNumber: string | null, setNameRaw: string | null): string | null {
  // Try from card_number first (most reliable): "SDJ-001" → "SDJ", "GFP2-EN175" → "GFP2"
  if (cardNumber) {
    const m = cardNumber.match(/^([A-Z0-9]+-?[A-Z]*?\d*)-/i);
    if (m) {
      // Extract just the set prefix: "GFP2-EN175" → "GFP2", "SDJ-001" → "SDJ"
      const raw = cardNumber.split("-")[0];
      if (raw && /[A-Z]/i.test(raw)) return raw.toUpperCase();
    }
  }
  // Try from set_name: "YuGiOh Starter Deck: Joey Price Guide | Yu-Gi-Oh SDJ |" → "SDJ"
  if (setNameRaw) {
    const pipeSegments = setNameRaw.split("|");
    if (pipeSegments.length >= 2) {
      const codeSegment = pipeSegments[1].trim(); // "Yu-Gi-Oh SDJ"
      const parts = codeSegment.split(/\s+/);
      const last = parts[parts.length - 1];
      if (last && /^[A-Z0-9]{2,10}$/i.test(last)) return last.toUpperCase();
    }
  }
  return null;
}

/** Extract clean set name from raw: "YuGiOh Starter Deck: Joey Price Guide | ..." → "Starter Deck: Joey" */
function extractSetName(setNameRaw: string): string {
  // Take first pipe segment
  const first = setNameRaw.split("|")[0].trim();
  // Remove "Price Guide" suffix, "YuGiOh " prefix
  let clean = first
    .replace(/\s*Price Guide\s*/i, "")
    .replace(/^YuGiOh\s+/i, "")
    .replace(/^Yu-Gi-Oh!?\s+/i, "")
    .replace(/^Pokemon\s+/i, "")
    .replace(/^Magic:?\s*The Gathering\s+/i, "")
    .trim();
  return clean || first;
}

/** Detect game from set_name field */
function detectGame(setNameRaw: string): string {
  const lower = setNameRaw.toLowerCase();
  if (lower.includes("yugioh") || lower.includes("yu-gi-oh")) return "yugioh";
  if (lower.includes("pokemon") || lower.includes("pokémon")) return "pokemon";
  if (lower.includes("magic") || lower.includes("mtg")) return "mtg";
  return "other";
}

/** Clean card name: remove card number suffix, brackets from variant in name */
function cleanCardName(rawName: string, cardNumber: string | null): string {
  let name = rawName;
  // Remove trailing card number like " SDJ-001"
  if (cardNumber) {
    const escaped = cardNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    name = name.replace(new RegExp(`\\s*${escaped}\\s*$`, "i"), "");
  }
  // Remove variant tags like [1st Edition] from name for clean matching
  name = name.replace(/\s*\[.*?\]\s*/g, " ");
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Parse variant field */
function cleanVariant(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^\[/, "").replace(/\]$/, "").trim();
  return cleaned || null;
}

// ── Parse XLSX ─────────────────────────────────────────────────────

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

  // Group by set (detected from internal data, NOT filename)
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

// ── Import to DB ───────────────────────────────────────────────────

export async function importParsedSets(
  userId: string,
  sets: ParsedSet[],
  onProgress?: (done: number, total: number) => void
): Promise<{ setsImported: number; cardsImported: number; setsUpdated: number }> {
  let setsImported = 0;
  let setsUpdated = 0;
  let cardsImported = 0;
  const totalCards = sets.reduce((s, set) => s + set.cards.length, 0);
  let processed = 0;

  for (const set of sets) {
    // Upsert set
    let setId: string;

    // Check if set already exists
    let query = supabase
      .from("pc_sets")
      .select("id")
      .eq("user_id", userId)
      .eq("game", set.game);

    if (set.set_code) {
      query = query.eq("set_code", set.set_code);
    } else {
      query = query.eq("set_name", set.set_name);
    }

    const { data: existing } = await query.maybeSingle();

    if (existing) {
      setId = existing.id;
      setsUpdated++;
      // Delete old cards to replace with fresh data
      await supabase.from("pc_cards").delete().eq("set_id", setId);
    } else {
      const { data: inserted, error } = await supabase
        .from("pc_sets")
        .insert({
          user_id: userId,
          game: set.game,
          set_code: set.set_code,
          set_name: set.set_name,
          set_name_raw: set.set_name_raw,
          source_url: set.source_url,
          total_cards: set.cards.length,
        })
        .select("id")
        .single();

      if (error || !inserted) {
        console.error("Failed to insert set:", error);
        continue;
      }
      setId = inserted.id;
      setsImported++;
    }

    // Update total_cards count
    await supabase.from("pc_sets").update({ total_cards: set.cards.length }).eq("id", setId);

    // Insert cards in batches
    const batchSize = 50;
    for (let i = 0; i < set.cards.length; i += batchSize) {
      const batch = set.cards.slice(i, i + batchSize).map((c) => ({
        set_id: setId,
        user_id: userId,
        card_name: c.card_name,
        card_name_clean: c.card_name_clean,
        card_number: c.card_number,
        variant: c.variant,
        card_url: c.card_url,
        ungraded_price: c.ungraded_price,
        graded_price: c.graded_price,
        grade9_price: c.grade9_price,
        psa10_price: c.psa10_price,
      }));

      const { error } = await supabase.from("pc_cards").insert(batch);
      if (error) {
        console.error("Failed to insert card batch:", error);
      } else {
        cardsImported += batch.length;
      }

      processed += batch.length;
      onProgress?.(processed, totalCards);
    }
  }

  return { setsImported, cardsImported, setsUpdated };
}

// ── Match Engine ───────────────────────────────────────────────────

export interface LocalPriceMatch {
  card_id: string;
  card_name: string;
  card_number: string | null;
  variant: string | null;
  set_name: string;
  set_code: string | null;
  ungraded_price: number | null;
  graded_price: number | null;
  grade9_price: number | null;
  psa10_price: number | null;
  confidence: number;
  match_type: "exact" | "exact_no_variant" | "fuzzy_name" | "name_only";
}

export async function matchCardLocally(
  userId: string,
  cardName: string,
  setCodeOrName: string | null,
  cardNumber: string | null,
  variant: string | null
): Promise<LocalPriceMatch | null> {
  // Step 1: Find the set
  let setId: string | null = null;
  let setName = "";
  let setCode: string | null = null;

  if (setCodeOrName) {
    // Try set_code first
    const { data: byCode } = await supabase
      .from("pc_sets")
      .select("id, set_name, set_code")
      .eq("user_id", userId)
      .ilike("set_code", setCodeOrName)
      .maybeSingle();

    if (byCode) {
      setId = byCode.id;
      setName = byCode.set_name;
      setCode = byCode.set_code;
    } else {
      // Try set_name
      const { data: byName } = await supabase
        .from("pc_sets")
        .select("id, set_name, set_code")
        .eq("user_id", userId)
        .ilike("set_name", `%${setCodeOrName}%`)
        .limit(1)
        .maybeSingle();

      if (byName) {
        setId = byName.id;
        setName = byName.set_name;
        setCode = byName.set_code;
      }
    }
  }

  const cleanName = cardName.replace(/\s*\[.*?\]\s*/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

  // Step 2: Try exact match by set + card_number + variant
  if (setId && cardNumber) {
    let q = supabase
      .from("pc_cards")
      .select("*")
      .eq("set_id", setId)
      .ilike("card_number", cardNumber);

    if (variant) q = q.ilike("variant", variant);

    const { data } = await q.limit(1);
    if (data && data.length > 0) {
      return toMatch(data[0], setName, setCode, variant ? "exact" : "exact_no_variant");
    }

    // Try without variant
    if (variant) {
      const { data: noVar } = await supabase
        .from("pc_cards")
        .select("*")
        .eq("set_id", setId)
        .ilike("card_number", cardNumber)
        .is("variant", null)
        .limit(1);

      if (noVar && noVar.length > 0) {
        return toMatch(noVar[0], setName, setCode, "exact_no_variant");
      }
    }
  }

  // Step 3: Fuzzy name match within set
  if (setId) {
    const { data } = await supabase
      .from("pc_cards")
      .select("*")
      .eq("set_id", setId)
      .ilike("card_name_clean", `%${cleanName}%`)
      .limit(5);

    if (data && data.length > 0) {
      // Pick best match
      const best = data.sort((a, b) => {
        const aExact = a.card_name_clean === cleanName ? 1 : 0;
        const bExact = b.card_name_clean === cleanName ? 1 : 0;
        return bExact - aExact;
      })[0];
      return toMatch(best, setName, setCode, "fuzzy_name");
    }
  }

  // Step 4: Global name search (no set constraint)
  const { data: global } = await supabase
    .from("pc_cards")
    .select("*, pc_sets!inner(set_name, set_code)")
    .eq("user_id", userId)
    .ilike("card_name_clean", `%${cleanName}%`)
    .limit(5);

  if (global && global.length > 0) {
    const best = global[0];
    const s = best.pc_sets as any;
    return toMatch(best, s?.set_name || "", s?.set_code || null, "name_only");
  }

  return null;
}

function toMatch(card: any, setName: string, setCode: string | null, matchType: LocalPriceMatch["match_type"]): LocalPriceMatch {
  const confidenceMap = { exact: 100, exact_no_variant: 90, fuzzy_name: 70, name_only: 50 };
  return {
    card_id: card.id,
    card_name: card.card_name,
    card_number: card.card_number,
    variant: card.variant,
    set_name: setName,
    set_code: setCode,
    ungraded_price: card.ungraded_price,
    graded_price: card.graded_price,
    grade9_price: card.grade9_price,
    psa10_price: card.psa10_price,
    confidence: confidenceMap[matchType],
    match_type: matchType,
  };
}

// ── Set Completion ─────────────────────────────────────────────────

export interface SetCompletion {
  set_id: string;
  set_name: string;
  set_code: string | null;
  game: string;
  total_cards: number;
  owned_cards: number;
  completion_pct: number;
  missing: { card_name: string; card_number: string | null; variant: string | null; ungraded_price: number | null }[];
}

export async function getSetCompletion(userId: string, setId: string): Promise<SetCompletion | null> {
  // Get set info
  const { data: set } = await supabase
    .from("pc_sets")
    .select("*")
    .eq("id", setId)
    .eq("user_id", userId)
    .single();

  if (!set) return null;

  // Get all master cards for this set
  const { data: masterCards } = await supabase
    .from("pc_cards")
    .select("card_name, card_number, variant, ungraded_price, card_name_clean")
    .eq("set_id", setId)
    .order("card_number");

  if (!masterCards) return null;

  // Get user's owned cards
  const { data: ownedCards } = await supabase
    .from("cards")
    .select("card_name, card_number, card_set, variant")
    .eq("user_id", userId);

  if (!ownedCards) return null;

  // Build owned lookup: normalize names for matching
  const ownedSet = new Set<string>();
  for (const c of ownedCards) {
    const key = `${(c.card_name || "").toLowerCase().trim()}|${(c.card_number || "").toLowerCase().trim()}`;
    ownedSet.add(key);
    // Also add without variant for broader matching
    const nameOnly = `${(c.card_name || "").toLowerCase().trim()}|`;
    ownedSet.add(nameOnly);
  }

  const missing: SetCompletion["missing"] = [];
  let owned = 0;

  for (const mc of masterCards) {
    const key = `${mc.card_name_clean}|${(mc.card_number || "").toLowerCase().trim()}`;
    const nameKey = `${mc.card_name_clean}|`;
    if (ownedSet.has(key) || ownedSet.has(nameKey)) {
      owned++;
    } else {
      missing.push({
        card_name: mc.card_name,
        card_number: mc.card_number,
        variant: mc.variant,
        ungraded_price: mc.ungraded_price,
      });
    }
  }

  return {
    set_id: setId,
    set_name: set.set_name,
    set_code: set.set_code,
    game: set.game,
    total_cards: masterCards.length,
    owned_cards: owned,
    completion_pct: masterCards.length > 0 ? Math.round((owned / masterCards.length) * 100) : 0,
    missing,
  };
}
