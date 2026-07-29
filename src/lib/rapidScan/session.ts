import { CAPTURE_PROFILES } from "./captureProfiles.ts";
import type {
  CaptureMode,
  CaptureProfileId,
  CaptureJob,
  RapidScanSession,
} from "./contracts";

const SCANNER_SETTINGS_KEY = "card-scanner-settings";

const DEFAULT_RAPID_SCAN_SESSION: RapidScanSession = {
  id: "active",
  game: "yugioh",
  selectedSetId: null,
  selectedSetName: null,
  profileId: "standard",
  captureMode: "manual",
};

type RapidScanSetSource = {
  id: string;
  set_name: string;
  game: string;
};

function normalizeGameName(game: string): RapidScanSession["game"] {
  const normalized = game.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized === "yugioh") return "yugioh";
  if (normalized === "pokemon") return "pokemon";
  if (normalized === "mtg" || normalized === "magicthegathering") return "mtg";
  if (
    normalized === "sports" ||
    ["baseball", "basketball", "football", "hockey", "soccer"].includes(
      normalized,
    )
  ) {
    return "sports";
  }
  return "other";
}

export function filterRapidScanSets(
  rows: readonly RapidScanSetSource[],
  game: RapidScanSession["game"],
): Array<{ id: string; name: string }> {
  const sets = new Map<string, string>();
  for (const row of rows) {
    const id = row.id.trim();
    const name = row.set_name.trim();
    if (!id || !name || normalizeGameName(row.game) !== game) continue;
    sets.set(id, name);
  }
  return Array.from(sets, ([id, name]) => ({ id, name })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function normalizeRapidScanSession(
  session: Partial<RapidScanSession> | null | undefined,
): RapidScanSession {
  const candidate = session ?? {};
  const game = ["yugioh", "pokemon", "mtg", "sports", "other"].includes(
    candidate.game ?? "",
  )
    ? candidate.game!
    : DEFAULT_RAPID_SCAN_SESSION.game;
  const profileId =
    candidate.profileId &&
    Object.prototype.hasOwnProperty.call(CAPTURE_PROFILES, candidate.profileId)
      ? candidate.profileId
      : DEFAULT_RAPID_SCAN_SESSION.profileId;
  const captureMode =
    candidate.captureMode === "auto" || candidate.captureMode === "manual"
      ? candidate.captureMode
      : DEFAULT_RAPID_SCAN_SESSION.captureMode;

  return {
    id: typeof candidate.id === "string" && candidate.id ? candidate.id : "active",
    game,
    selectedSetId:
      typeof candidate.selectedSetId === "string" && candidate.selectedSetId
        ? candidate.selectedSetId
        : null,
    selectedSetName:
      typeof candidate.selectedSetName === "string" && candidate.selectedSetName
        ? candidate.selectedSetName
        : null,
    profileId,
    captureMode,
  };
}

export function snapshotRapidScanCaptureContext(
  session: RapidScanSession,
  rotation: CaptureJob["rotation"],
): Pick<CaptureJob, "session" | "rotation"> {
  return {
    session: normalizeRapidScanSession(session),
    rotation,
  };
}

type PersistedScannerSettings = {
  captureMode?: CaptureMode;
  selectedSetId?: string | null;
  selectedSetName?: string | null;
  captureProfileId?: CaptureProfileId;
  rapidScanGame?: RapidScanSession["game"];
  gameTypeFilter?: string;
  [key: string]: unknown;
};

function readScannerSettings(): PersistedScannerSettings {
  if (typeof localStorage === "undefined") return {};
  try {
    const stored = localStorage.getItem(SCANNER_SETTINGS_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : {};
    return parsed && typeof parsed === "object"
      ? parsed as PersistedScannerSettings
      : {};
  } catch (error) {
    console.error("Failed to load Rapid Scan session:", error);
    return {};
  }
}

export function getRapidScanSession(): RapidScanSession {
  const settings = readScannerSettings();
  return normalizeRapidScanSession({
    id: "active",
    game: (settings.rapidScanGame ?? settings.gameTypeFilter) as
      RapidScanSession["game"],
    selectedSetId: settings.selectedSetId,
    selectedSetName: settings.selectedSetName,
    profileId: settings.captureProfileId,
    captureMode: settings.captureMode,
  });
}

export function saveRapidScanSession(session: RapidScanSession): void {
  if (typeof localStorage === "undefined") return;
  const snapshot = normalizeRapidScanSession(session);
  const settings = readScannerSettings();
  try {
    localStorage.setItem(
      SCANNER_SETTINGS_KEY,
      JSON.stringify({
        ...settings,
        captureMode: snapshot.captureMode,
        selectedSetId: snapshot.selectedSetId,
        selectedSetName: snapshot.selectedSetName,
        captureProfileId: snapshot.profileId,
        rapidScanGame: snapshot.game,
      }),
    );
  } catch (error) {
    console.error("Failed to save Rapid Scan session:", error);
  }
}
