type NameResolvableCard = {
  card_name?: string | null;
  card_set?: string | null;
  card_number?: string | null;
  game_type?: string | null;
  sport_type?: string | null;
  year?: number | string | null;
};

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCardNumber(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/\s+/g, "").toUpperCase();
}

function normalizeGameType(gameType?: string | null, sportType?: string | null): "yugioh" | "pokemon" | "mtg" | "sports" | "other" {
  const raw = (gameType || sportType || "").toLowerCase();
  if (raw.includes("yu") || raw.includes("ygo")) return "yugioh";
  if (raw.includes("pok")) return "pokemon";
  if (raw.includes("magic") || raw.includes("mtg")) return "mtg";
  if (raw.includes("sport") || ["baseball", "basketball", "football", "hockey", "soccer"].some((s) => raw.includes(s))) {
    return "sports";
  }
  return "other";
}

function normalizeForMatch(value: string | null): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function dedupeNames(names: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const c = clean(name);
    if (!c) continue;
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function withTimeout(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function fetchJson(url: string, timeoutMs = 5000): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: withTimeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function extractPokemonParts(cardNumber: string | null): { left: string | null; right: string | null } {
  if (!cardNumber) return { left: null, right: null };
  const normalized = normalizeCardNumber(cardNumber);
  if (!normalized) return { left: null, right: null };
  const [left, right] = normalized.split("/");
  return {
    left: left || null,
    right: right || null,
  };
}

function extractPrintedNameFromOCR(ocrText?: string): string | null {
  if (!ocrText) return null;
  const lines = ocrText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const alphaCount = Array.from(line).filter((ch) => /[A-Za-z]/.test(ch)).length;
    if (alphaCount < 3) continue;

    const lower = line.toLowerCase();
    if (
      lower.includes("trading card") ||
      lower.includes("pokemon") ||
      lower.includes("konami") ||
      lower.includes("wizards") ||
      lower.includes("game")
    ) {
      continue;
    }

    return line;
  }

  return null;
}

async function lookupYugiohBySetCode(candidateNames: string[], cardNumber: string): Promise<{ card_name: string; card_set: string | null; card_number: string } | null> {
  const normalizedTarget = normalizeCardNumber(cardNumber);
  if (!normalizedTarget || !/^[A-Z0-9]{2,5}-[A-Z]{0,2}[0-9]{3}$/.test(normalizedTarget)) {
    return null;
  }

  // First try direct set-code lookup (no candidate names needed)
  const directResult = await lookupYgoBySetCodeDirect(normalizedTarget);
  if (directResult) return directResult;

  // Fallback: search by candidate names + match set code
  for (const candidate of candidateNames) {
    const data = await fetchJson(`https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(candidate)}`);
    const cards = data?.data;
    if (!Array.isArray(cards)) continue;

    for (const card of cards) {
      const sets = Array.isArray(card?.card_sets) ? card.card_sets : [];
      const match = sets.find((s: any) => normalizeCardNumber(clean(s?.set_code)) === normalizedTarget);
      if (match) {
        return {
          card_name: clean(card?.name) || candidate,
          card_set: clean(match?.set_name),
          card_number: clean(match?.set_code) || normalizedTarget,
        };
      }
    }
  }

  return null;
}

/**
 * Direct YGOPRODeck lookup by set code only (e.g. "SDBE-EN017").
 * Searches all cards that appear in the set prefix, then matches the exact code.
 */
async function lookupYgoBySetCodeDirect(normalizedCode: string): Promise<{ card_name: string; card_set: string | null; card_number: string } | null> {
  // Extract set prefix (e.g. "SDBE" from "SDBE-EN017")
  const dashIdx = normalizedCode.indexOf("-");
  if (dashIdx < 2) return null;
  const setPrefix = normalizedCode.substring(0, dashIdx);

  // YGOPRODeck supports searching by card set code prefix via the cardset parameter
  const data = await fetchJson(
    `https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset=${encodeURIComponent(setPrefix)}&num=100&offset=0`,
    8000
  );
  const cards = Array.isArray(data?.data) ? data.data : [];

  for (const card of cards) {
    const sets = Array.isArray(card?.card_sets) ? card.card_sets : [];
    const match = sets.find((s: any) => normalizeCardNumber(clean(s?.set_code)) === normalizedCode);
    if (match) {
      return {
        card_name: clean(card?.name) || "Unknown Card",
        card_set: clean(match?.set_name),
        card_number: clean(match?.set_code) || normalizedCode,
      };
    }
  }

  return null;
}

/**
 * Public helper: verify a YGO card's set name using YGOPRODeck.
 * Used by edge functions for post-processing AI results.
 */
export async function verifyYgoSetCode(
  cardData: { card_name?: string | null; card_number?: string | null; card_set?: string | null }
): Promise<{ card_name: string; card_set: string | null; card_number: string } | null> {
  const cardNumber = normalizeCardNumber(clean(cardData.card_number));
  if (!cardNumber || !/^[A-Z0-9]{2,5}-[A-Z]{0,2}[0-9]{3}$/.test(cardNumber)) {
    return null;
  }

  const candidateNames = dedupeNames([cardData.card_name]);
  return lookupYugiohBySetCode(candidateNames, cardNumber);
}

function isLikelySetMatch(inputSet: string | null, apiSetObj: any): boolean {
  if (!inputSet) return false;
  const setKey = normalizeForMatch(inputSet);
  if (!setKey) return false;

  const setName = normalizeForMatch(clean(apiSetObj?.name));
  const setId = normalizeForMatch(clean(apiSetObj?.id));
  const setCode = normalizeForMatch(clean(apiSetObj?.ptcgoCode));

  return [setName, setId, setCode].some((value) => value && (value.includes(setKey) || setKey.includes(value)));
}

async function lookupPokemonByNumber(
  candidateNames: string[],
  cardNumber: string,
  inputSet: string | null
): Promise<{ card_name: string; card_set: string | null; card_number: string } | null> {
  const { left, right } = extractPokemonParts(cardNumber);
  if (!left) return null;

  const data = await fetchJson(`https://api.pokemontcg.io/v2/cards?q=number:${encodeURIComponent(left)}&pageSize=50`);
  const cards = Array.isArray(data?.data) ? data.data : [];
  if (!cards.length) return null;

  let best: any = null;
  let bestScore = -1;

  for (const card of cards) {
    const apiName = clean(card?.name);
    const apiNumber = clean(card?.number);
    if (!apiName || !apiNumber) continue;

    const apiPrintedTotal = card?.set?.printedTotal ?? card?.set?.total ?? null;
    const apiFullNumber = apiPrintedTotal ? `${apiNumber}/${apiPrintedTotal}` : apiNumber;

    let score = 0;
    const apiNameNorm = normalizeForMatch(apiName);

    for (const candidate of candidateNames) {
      const candidateNorm = normalizeForMatch(candidate);
      if (!candidateNorm) continue;
      if (apiNameNorm === candidateNorm) score += 100;
      else if (apiNameNorm.includes(candidateNorm) || candidateNorm.includes(apiNameNorm)) score += 35;
    }

    if (isLikelySetMatch(inputSet, card?.set)) score += 45;

    if (right && apiPrintedTotal && String(apiPrintedTotal) === right) score += 30;

    const inputNormalized = normalizeCardNumber(cardNumber);
    const apiNormalized = normalizeCardNumber(apiFullNumber);
    if (inputNormalized && apiNormalized && inputNormalized === apiNormalized) score += 15;

    if (score > bestScore) {
      best = card;
      bestScore = score;
    }
  }

  if (!best || bestScore < 45) return null;

  const num = clean(best?.number);
  const total = best?.set?.printedTotal ?? best?.set?.total ?? null;
  return {
    card_name: clean(best?.name) || candidateNames[0] || "Unknown Card",
    card_set: clean(best?.set?.name),
    card_number: total && num ? `${num}/${total}` : num || cardNumber,
  };
}

async function lookupMtgBySetAndNumber(
  cardSet: string | null,
  cardNumber: string
): Promise<{ card_name: string; card_set: string | null; card_number: string; year?: number } | null> {
  const setCode = clean(cardSet)?.toLowerCase();
  if (!setCode || !/^[a-z0-9]{2,6}$/.test(setCode)) return null;

  const collectorNo = clean(cardNumber)?.toLowerCase();
  if (!collectorNo) return null;

  const data = await fetchJson(`https://api.scryfall.com/cards/${encodeURIComponent(setCode)}/${encodeURIComponent(collectorNo)}`);
  if (!data?.name) return null;

  const year = data.released_at ? parseInt(data.released_at.substring(0, 4)) : undefined;

  return {
    card_name: clean(data.name) || "Unknown Card",
    card_set: clean(data.set_name) || cardSet,
    card_number: clean(data.collector_number) || cardNumber,
    ...(year ? { year } : {}),
  };
}

async function lookupMtgByNameAndSet(
  candidateNames: string[],
  cardSet: string | null,
  year: number | null
): Promise<{ card_name: string; card_set: string | null; card_number: string; year?: number } | null> {
  if (!candidateNames.length) return null;

  const primaryName = candidateNames[0];

  // Try exact name search on Scryfall
  const query = `!"${primaryName}"`;
  const data = await fetchJson(
    `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=released&dir=asc`,
    8000
  );
  const cards = Array.isArray(data?.data) ? data.data : [];
  if (!cards.length) return null;

  // If we have a year, find the printing from that year
  if (year) {
    const yearMatch = cards.find((c: any) => {
      const relYear = c.released_at ? parseInt(c.released_at.substring(0, 4)) : 0;
      return relYear === year;
    });
    if (yearMatch) {
      return {
        card_name: clean(yearMatch.name) || primaryName,
        card_set: clean(yearMatch.set_name),
        card_number: clean(yearMatch.collector_number) || null as any,
        year,
      };
    }
  }

  // If we have a set name, fuzzy match it
  if (cardSet) {
    const setKey = normalizeForMatch(cardSet);
    const setMatch = cards.find((c: any) => {
      const apiSetName = normalizeForMatch(clean(c.set_name));
      const apiSetCode = normalizeForMatch(clean(c.set));
      return (apiSetName && (apiSetName.includes(setKey) || setKey.includes(apiSetName)))
        || (apiSetCode && setKey === apiSetCode);
    });
    if (setMatch) {
      const relYear = setMatch.released_at ? parseInt(setMatch.released_at.substring(0, 4)) : undefined;
      return {
        card_name: clean(setMatch.name) || primaryName,
        card_set: clean(setMatch.set_name),
        card_number: clean(setMatch.collector_number) || null as any,
        ...(relYear ? { year: relYear } : {}),
      };
    }
  }

  // Fallback: return the first (oldest) printing
  const first = cards[0];
  const relYear = first.released_at ? parseInt(first.released_at.substring(0, 4)) : undefined;
  return {
    card_name: clean(first.name) || primaryName,
    card_set: clean(first.set_name),
    card_number: clean(first.collector_number) || null as any,
    ...(relYear ? { year: relYear } : {}),
  };
}

export async function resolveOfficialCardIdentity<T extends NameResolvableCard>(
  card: T,
  opts?: { ocrText?: string }
): Promise<T> {
  const currentName = clean(card.card_name) || "Unknown Card";
  const printedName = extractPrintedNameFromOCR(opts?.ocrText);
  const cardNumber = normalizeCardNumber(clean(card.card_number));
  const cardSet = clean(card.card_set);
  const game = normalizeGameType(card.game_type, card.sport_type);
  const candidateNames = dedupeNames([currentName, printedName]);

  // Parse year from card (may be number or string)
  const cardYear = card.year ? (typeof card.year === "number" ? card.year : parseInt(String(card.year))) : null;
  const validYear = cardYear && cardYear >= 1993 && cardYear <= 2030 ? cardYear : null;

  let verified: { card_name: string; card_set: string | null; card_number: string; year?: number } | null = null;

  if (cardNumber) {
    if (game === "yugioh") {
      verified = await lookupYugiohBySetCode(candidateNames, cardNumber);
    } else if (game === "pokemon") {
      verified = await lookupPokemonByNumber(candidateNames, cardNumber, cardSet);
    } else if (game === "mtg") {
      verified = await lookupMtgBySetAndNumber(cardSet, cardNumber);
    }
  }

  // MTG fallback: search by name + set/year when set+number lookup fails
  if (!verified && game === "mtg" && candidateNames.length > 0) {
    verified = await lookupMtgByNameAndSet(candidateNames, cardSet, validYear);
  }

  if (verified?.card_name) {
    const result: any = {
      ...card,
      card_name: verified.card_name,
      card_set: verified.card_set ?? card.card_set ?? null,
      card_number: verified.card_number ?? card.card_number ?? null,
    };
    if ((verified as any).year) {
      result.year = (verified as any).year;
    }
    return result;
  }

  if (printedName && printedName !== currentName) {
    return {
      ...card,
      card_name: printedName,
    };
  }

  return {
    ...card,
    card_name: currentName,
  };
}
