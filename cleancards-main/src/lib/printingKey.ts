// Canonical printing key generator - must match DB computed column formula
// Format: game|set|number|edition|variant|language|finish

export interface PrintingKeyInput {
  game_type?: string | null;
  set_code?: string | null;
  card_set?: string | null;
  card_number?: string | null;
  edition?: string | null;
  variant?: string | null;
  language?: string | null;
  finish?: string | null;
}

export function generatePrintingKey(card: PrintingKeyInput): string {
  const game = (card.game_type || 'unknown').toLowerCase();
  const set = (card.set_code || card.card_set || 'unknown').toLowerCase();
  const number = (card.card_number || 'unknown').toLowerCase();
  const edition = (card.edition || 'standard').toLowerCase();
  const variant = (card.variant || 'base').toLowerCase();
  const language = (card.language || 'en').toLowerCase();
  const finish = (card.finish || 'normal').toLowerCase();

  return `${game}|${set}|${number}|${edition}|${variant}|${language}|${finish}`;
}

// Check if a printing key represents a fully identified card
export function isValidPrintingKey(key: string): boolean {
  const parts = key.split('|');
  if (parts.length !== 7) return false;
  
  // At minimum, we need game and set to not be 'unknown'
  const [game, set, number] = parts;
  return game !== 'unknown' && set !== 'unknown' && number !== 'unknown';
}

// Parse a printing key back to components
export function parsePrintingKey(key: string): PrintingKeyInput {
  const [game_type, set_code, card_number, edition, variant, language, finish] = key.split('|');
  return {
    game_type: game_type === 'unknown' ? null : game_type,
    set_code: set_code === 'unknown' ? null : set_code,
    card_number: card_number === 'unknown' ? null : card_number,
    edition: edition === 'standard' ? null : edition,
    variant: variant === 'base' ? null : variant,
    language: language === 'en' ? null : language,
    finish: finish === 'normal' ? null : finish,
  };
}
