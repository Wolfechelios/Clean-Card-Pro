import { useAutopilot } from "@/hooks/useAutopilot";

export function AutopilotPanel({ cards }: { cards: any[] }) {
  const { nextAction } = useAutopilot(cards);

  if (!nextAction) return null;

  return (
    <div className="rounded-lg border p-4 bg-card">
      <div className="text-sm font-semibold">Collection Autopilot</div>
      <div className="text-sm text-muted-foreground">{nextAction.reason}</div>
      <div className="text-xs uppercase mt-1">Action: {nextAction.type}</div>
    </div>
  );
}
