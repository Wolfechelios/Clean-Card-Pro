import { useMemo } from "react";
import { runAutopilot, AutopilotCard } from "@/lib/autopilot";

export function useAutopilot(cards: AutopilotCard[]) {
  const actions = useMemo(() => {
    if (!cards || cards.length === 0) return [];
    return runAutopilot(cards);
  }, [cards]);

  return {
    actions,
    nextAction: actions[0] ?? null,
  };
}
