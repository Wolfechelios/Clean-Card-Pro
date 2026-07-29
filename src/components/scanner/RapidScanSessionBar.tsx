import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CAPTURE_PROFILES } from "@/lib/rapidScan/captureProfiles";
import type {
  CaptureMode,
  CaptureProfileId,
  RapidScanSession,
} from "@/lib/rapidScan/contracts";

export type RapidScanSessionBarProps = {
  session: RapidScanSession;
  sets: Array<{ id: string; name: string }>;
  counts: Record<
    "captured" | "processing" | "saved" | "review" | "errors",
    number
  >;
  onChange(next: RapidScanSession): void;
};

const ALL_SETS = "__all_sets__";

const GAMES: Array<{ id: RapidScanSession["game"]; label: string }> = [
  { id: "yugioh", label: "Yu-Gi-Oh!" },
  { id: "pokemon", label: "Pokémon" },
  { id: "mtg", label: "Magic: The Gathering" },
  { id: "sports", label: "Sports" },
  { id: "other", label: "Other" },
];

export function RapidScanSessionBar({
  session,
  sets,
  counts,
  onChange,
}: RapidScanSessionBarProps) {
  const update = (patch: Partial<RapidScanSession>) => {
    onChange({ ...session, ...patch });
  };

  const updateSet = (setId: string) => {
    if (setId === ALL_SETS) {
      update({ selectedSetId: null, selectedSetName: null });
      return;
    }
    const selectedSet = sets.find((set) => set.id === setId);
    update({
      selectedSetId: selectedSet?.id ?? null,
      selectedSetName: selectedSet?.name ?? null,
    });
  };

  const updateMode = (captureMode: CaptureMode) => {
    update({ captureMode });
  };

  return (
    <div className="space-y-2 rounded-xl border bg-card p-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_1.35fr_1.2fr_auto]">
        <Select
          value={session.game}
          onValueChange={(game) => {
            update({
              game: game as RapidScanSession["game"],
              selectedSetId: null,
              selectedSetName: null,
            });
          }}
        >
          <SelectTrigger aria-label="Game">
            <SelectValue placeholder="Game" />
          </SelectTrigger>
          <SelectContent>
            {GAMES.map((game) => (
              <SelectItem key={game.id} value={game.id}>
                {game.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={session.selectedSetId ?? ALL_SETS}
          onValueChange={updateSet}
        >
          <SelectTrigger aria-label="Set">
            <SelectValue placeholder="All sets" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_SETS}>All sets</SelectItem>
            {sets.map((set) => (
              <SelectItem key={set.id} value={set.id}>
                {set.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={session.profileId}
          onValueChange={(profileId) =>
            update({ profileId: profileId as CaptureProfileId })
          }
        >
          <SelectTrigger aria-label="Card profile">
            <SelectValue placeholder="Card profile" />
          </SelectTrigger>
          <SelectContent>
            {Object.values(CAPTURE_PROFILES).map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="grid grid-cols-2 gap-1" aria-label="Capture mode">
          <Button
            type="button"
            size="sm"
            variant={session.captureMode === "manual" ? "default" : "outline"}
            aria-pressed={session.captureMode === "manual"}
            onClick={() => updateMode("manual")}
          >
            Manual
          </Button>
          <Button
            type="button"
            size="sm"
            variant={session.captureMode === "auto" ? "default" : "outline"}
            aria-pressed={session.captureMode === "auto"}
            onClick={() => updateMode("auto")}
          >
            Auto
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline">Captured {counts.captured}</Badge>
        <Badge variant="secondary">Processing {counts.processing}</Badge>
        <Badge variant="outline">Saved {counts.saved}</Badge>
        <Badge variant={counts.review > 0 ? "secondary" : "outline"}>
          Review {counts.review}
        </Badge>
        <Badge variant={counts.errors > 0 ? "destructive" : "outline"}>
          Errors {counts.errors}
        </Badge>
      </div>
    </div>
  );
}
