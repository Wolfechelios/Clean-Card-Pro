// Duplicate detection using printing_key
// This is the canonical way to check if a card already exists in the user's library

import { supabase } from "@/integrations/supabase/client";
import { generatePrintingKey, PrintingKeyInput } from "./printingKey";

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingCardId?: string;
  existingQuantity?: number;
  printingKey: string;
}

/**
 * Check if a card with the same printing_key already exists for this user
 * Uses the DB-computed printing_key column for exact matching
 */
export async function checkDuplicateByPrintingKey(
  userId: string,
  card: PrintingKeyInput
): Promise<DuplicateCheckResult> {
  const printingKey = generatePrintingKey(card);
  
  const { data, error } = await supabase
    .from('cards')
    .select('id, quantity')
    .eq('user_id', userId)
    .eq('printing_key', printingKey)
    .maybeSingle();

  if (error) {
    console.error('Duplicate check error:', error);
    // Fail open - don't block the insert
    return { isDuplicate: false, printingKey };
  }

  if (data) {
    return {
      isDuplicate: true,
      existingCardId: data.id,
      existingQuantity: data.quantity ?? 1,
      printingKey,
    };
  }

  return { isDuplicate: false, printingKey };
}

/**
 * Increment quantity of an existing card instead of creating a duplicate
 */
export async function incrementCardQuantity(
  cardId: string,
  incrementBy: number = 1
): Promise<{ success: boolean; newQuantity?: number; error?: string }> {
  // First get current quantity
  const { data: current, error: fetchError } = await supabase
    .from('cards')
    .select('quantity')
    .eq('id', cardId)
    .single();

  if (fetchError) {
    return { success: false, error: fetchError.message };
  }

  const currentQty = current?.quantity ?? 1;
  const newQuantity = currentQty + incrementBy;

  const { error: updateError } = await supabase
    .from('cards')
    .update({ quantity: newQuantity })
    .eq('id', cardId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  return { success: true, newQuantity };
}

/**
 * Get owned quantity map for a list of printing keys
 * Efficient batch lookup for scan results
 */
export async function getOwnedQuantityMap(
  userId: string,
  printingKeys: string[]
): Promise<Map<string, { id: string; quantity: number }>> {
  if (printingKeys.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('cards')
    .select('id, printing_key, quantity')
    .eq('user_id', userId)
    .in('printing_key', printingKeys);

  if (error) {
    console.error('Batch quantity lookup error:', error);
    return new Map();
  }

  const map = new Map<string, { id: string; quantity: number }>();
  for (const card of data || []) {
    if (card.printing_key) {
      map.set(card.printing_key, {
        id: card.id,
        quantity: card.quantity ?? 1,
      });
    }
  }

  return map;
}
