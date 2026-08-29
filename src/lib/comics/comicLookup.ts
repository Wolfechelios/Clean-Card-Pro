// Comic identification + valuation, free sources first.
//
// Order of resolution:
//   1. Local collection history (already-entered values for the same issue) — free.
//   2. Open metadata: Marvel-free Comic Vine is optional and only used when the
//      user has entered their own API key. No AI research services are called
//      unless the user supplies a key for them.
//   3. Manual entry fallback, so a comic is never silently mispriced.

import { findPreviousComicValue } from "./comicStore";

export const COMICVINE_KEY_STORAGE = "cc_comicvine_api_key";

export function getComicVineKey(): string | null {
  try {
    const value = localStorage.getItem(COMICVINE_KEY_STORAGE);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function setComicVineKey(key: string | null): void {
  try {
    if (key && key.trim()) localStorage.setItem(COMICVINE_KEY_STORAGE, key.trim());
    else localStorage.removeItem(COMICVINE_KEY_STORAGE);
  } catch {
    /* storage disabled */
  }
}

export type ComicLookupResult = {
  matched: boolean;
  source: "local-history" | "comicvine" | "manual";
  title?: string;
  issueNumber?: string;
  year?: number;
  publisher?: string;
  coverUrl?: string | null;
  valueRaw?: number | null;
  note?: string;
};

type ComicVineIssue = {
  name?: string | null;
  issue_number?: string;
  cover_date?: string | null;
  image?: { medium_url?: string };
  volume?: { name?: string; publisher?: { name?: string } };
};

async function lookupComicVine(
  title: string,
  issueNumber: string | undefined,
  key: string,
): Promise<ComicLookupResult | null> {
  const params = new URLSearchParams({
    api_key: key,
    format: "json",
    limit: "1",
    filter: issueNumber ? `volume:${title},issue_number:${issueNumber}` : `name:${title}`,
    field_list: "name,issue_number,cover_date,image,volume",
  });

  try {
    const res = await fetch(`https://comicvine.gamespot.com/api/issues/?${params.toString()}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { results?: ComicVineIssue[] };
    const issue = json.results?.[0];
    if (!issue) return null;
    return {
      matched: true,
      source: "comicvine",
      title: issue.volume?.name || issue.name || title,
      issueNumber: issue.issue_number || issueNumber,
      year: issue.cover_date ? Number(issue.cover_date.slice(0, 4)) || undefined : undefined,
      publisher: issue.volume?.publisher?.name,
      coverUrl: issue.image?.medium_url ?? null,
      valueRaw: null,
      note: "Metadata from Comic Vine. Comic Vine does not publish prices — set the value manually.",
    };
  } catch {
    return null;
  }
}

export async function lookupComic(args: {
  title?: string | null;
  issueNumber?: string | null;
  year?: number | null;
  publisher?: string | null;
}): Promise<ComicLookupResult> {
  const title = (args.title ?? "").trim();
  const issueNumber = (args.issueNumber ?? "").trim() || undefined;

  if (!title) {
    return {
      matched: false,
      source: "manual",
      note: "Could not read the cover title. Enter the title and issue number manually.",
    };
  }

  const previous = await findPreviousComicValue(title, issueNumber);
  if (previous) {
    return {
      matched: true,
      source: "local-history",
      title: previous.title,
      issueNumber: previous.issueNumber,
      year: previous.year,
      publisher: previous.publisher,
      valueRaw: previous.valueGraded ?? previous.valueRaw ?? null,
      note: "Value reused from a copy already in your collection.",
    };
  }

  const key = getComicVineKey();
  if (key) {
    const remote = await lookupComicVine(title, issueNumber, key);
    if (remote) return remote;
  }

  return {
    matched: false,
    source: "manual",
    title,
    issueNumber,
    year: args.year ?? undefined,
    publisher: args.publisher ?? undefined,
    valueRaw: null,
    note: key
      ? "No online match. Confirm the details and set the value manually."
      : "Read from the cover. Add a Comic Vine API key in Comics settings for automatic metadata.",
  };
}
