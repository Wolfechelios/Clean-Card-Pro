export type AutopilotActionType = "BUY" | "SELL" | "IGNORE";

export interface AutopilotAction {
  type: AutopilotActionType;
  cardId: string;
  reason: string;
  priority: number;
}

export interface AutopilotCard {
  id: string;
  owned: boolean;
  quantity?: number;
  current_price_raw?: number;
}

export function runAutopilot(cards: AutopilotCard[]): AutopilotAction[] {
  const actions: AutopilotAction[] = [];

  for (const card of cards) {
    const qty = card.quantity ?? 1;

    if (qty > 1) {
      actions.push({
        type: "SELL",
        cardId: card.id,
        reason: "Duplicate quantity detected.",
        priority: 90,
      });
    }
  }

  return actions.sort((a, b) => b.priority - a.priority);
}
