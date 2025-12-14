import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Junk tokens to remove from names (case-insensitive)
const JUNK_TOKENS = [
  /\s*\(?1st\s*edition\)?\s*/i,
  /\s*\(?first\s*edition\)?\s*/i,
  /\s*\(?unlimited\)?\s*/i,
  /\s*\(?reverse\s*holo\)?\s*/i,
  /\s*\(?rev\s*holo\)?\s*/i,
  /\s*\(?holo\)?\s*/i,
  /\s*\(?foil\)?\s*/i,
  /\s*\(?non-foil\)?\s*/i,
  /\s*\(?promo\)?\s*/i,
  /\s*\(?prerelease\)?\s*/i,
  /\s*\(?signed\)?\s*/i,
  /\s*\(?autograph\)?\s*/i,
  /\s*\(?PSA\s*\d+\.?\d*\)?\s*/i,
  /\s*\(?BGS\s*\d+\.?\d*\)?\s*/i,
  /\s*\(?CGC\s*\d+\.?\d*\)?\s*/i,
  /\s*\(?\s*NM\s*\)?\s*$/i,
  /\s*\(?\s*LP\s*\)?\s*$/i,
  /\s*\(?\s*MP\s*\)?\s*$/i,
  /\s*\(?\s*HP\s*\)?\s*$/i,
  /\s*\(?\s*Near\s*Mint\s*\)?\s*$/i,
];

// Sports variants to extract
const SPORTS_VARIANTS = [
  'silver prizm', 'gold prizm', 'prizm', 'refractor', 'chrome', 'auto', 'autograph',
  'patch', 'relic', 'jersey', 'memorabilia', 'parallel', 'numbered', '/99', '/25', '/10', '/5', '/1',
  'insert', 'base', 'rookie', 'rc', 'optic', 'select', 'mosaic', 'rated rookie'
];

// Clean string utility
function cleanString(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[^\w]+|[^\w]+$/g, '')
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/[–—]/g, '-');
}

// Extract year from string
function extractYear(str: string): { year: number | null; cleaned: string } {
  const yearMatch = str.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[0]);
    const cleaned = str.replace(yearMatch[0], '').trim();
    return { year, cleaned };
  }
  return { year: null, cleaned: str };
}

// Extract variant from name
function extractVariant(name: string): { variant: string | null; cleaned: string } {
  let cleaned = name.toLowerCase();
  const foundVariants: string[] = [];
  
  for (const variant of SPORTS_VARIANTS) {
    if (cleaned.includes(variant.toLowerCase())) {
      foundVariants.push(variant);
      cleaned = cleaned.replace(new RegExp(variant, 'gi'), '').trim();
    }
  }
  
  return {
    variant: foundVariants.length > 0 ? foundVariants.join(', ') : null,
    cleaned: name
  };
}

// Remove junk tokens from name
function removeJunkTokens(name: string): { cleaned: string; removed: string[] } {
  let cleaned = name;
  const removed: string[] = [];
  
  for (const pattern of JUNK_TOKENS) {
    const match = cleaned.match(pattern);
    if (match) {
      removed.push(match[0].trim());
      cleaned = cleaned.replace(pattern, ' ').trim();
    }
  }
  
  return { cleaned: cleanString(cleaned), removed };
}

// Normalize MTG card
function normalizeMTG(card: any): { updates: any; confidence: number; notes: any } {
  const notes: any = { game: 'mtg' };
  const updates: any = {};
  let confidence = 50;
  
  // Clean name
  const { cleaned: cleanedName, removed } = removeJunkTokens(card.card_name || '');
  if (cleanedName !== card.card_name) {
    updates.card_name = cleanedName;
    notes.removedTokens = removed;
  }
  
  // Process set code
  if (card.card_set) {
    let setCode = card.card_set.toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/^set:\s*/i, '')
      .trim();
    if (setCode !== card.card_set?.toLowerCase()) {
      updates.card_set = setCode;
      notes.normalizedSetCode = true;
    }
  }
  
  // Process card number (handle 123/280 format)
  if (card.card_number) {
    const numMatch = card.card_number.match(/^(\d+)(?:\/(\d+))?$/);
    if (numMatch) {
      updates.card_number = numMatch[1];
      if (numMatch[2]) {
        notes.printTotal = parseInt(numMatch[2]);
      }
    }
  }
  
  // Calculate confidence
  if (updates.card_set || card.card_set) confidence += 20;
  if (updates.card_number || card.card_number) confidence += 20;
  if (cleanedName) confidence += 10;
  
  return { updates, confidence: Math.min(confidence, 100), notes };
}

// Normalize Pokemon card
function normalizePokemon(card: any): { updates: any; confidence: number; notes: any } {
  const notes: any = { game: 'pokemon' };
  const updates: any = {};
  let confidence = 50;
  
  // Clean name
  const { cleaned: cleanedName, removed } = removeJunkTokens(card.card_name || '');
  if (cleanedName !== card.card_name) {
    updates.card_name = cleanedName;
    notes.removedTokens = removed;
  }
  
  // Process set name
  if (card.card_set) {
    let setName = card.card_set
      .replace(/^pokemon\s*/i, '')
      .replace(/^series:\s*/i, '')
      .trim();
    if (setName !== card.card_set) {
      updates.set_name = setName;
      notes.normalizedSetName = true;
    }
  }
  
  // Process card number
  if (card.card_number) {
    const numMatch = card.card_number.match(/^(\d+)(?:\/\d+)?$/);
    if (numMatch) {
      updates.card_number = numMatch[1];
    }
  }
  
  // Calculate confidence
  if (cleanedName) confidence += 15;
  if (card.card_set || updates.set_name) confidence += 20;
  if (card.card_number || updates.card_number) confidence += 15;
  
  return { updates, confidence: Math.min(confidence, 100), notes };
}

// Normalize Yu-Gi-Oh card
function normalizeYuGiOh(card: any): { updates: any; confidence: number; notes: any } {
  const notes: any = { game: 'yugioh' };
  const updates: any = {};
  let confidence = 50;
  
  let name = card.card_name || '';
  
  // Extract set code from name if present (e.g., "Blue-Eyes White Dragon (SDK-001)")
  const setCodeMatch = name.match(/\(([A-Z0-9]+-[A-Z]*\d+)\)/i);
  if (setCodeMatch && !card.card_set) {
    updates.card_set = setCodeMatch[1].toLowerCase();
    name = name.replace(setCodeMatch[0], '').trim();
    notes.extractedSetCode = setCodeMatch[1];
    confidence += 30;
  }
  
  // Clean name
  const { cleaned: cleanedName, removed } = removeJunkTokens(name);
  if (cleanedName !== card.card_name) {
    updates.card_name = cleanedName;
    notes.removedTokens = removed;
  }
  
  // Normalize existing set code
  if (card.card_set && !updates.card_set) {
    updates.card_set = card.card_set.toLowerCase();
    confidence += 25;
  }
  
  // Calculate confidence
  if (cleanedName) confidence += 10;
  if (updates.card_set || card.card_set) confidence += 15;
  
  return { updates, confidence: Math.min(confidence, 100), notes };
}

// Normalize Sports card
function normalizeSports(card: any): { updates: any; confidence: number; notes: any } {
  const notes: any = { game: 'sports' };
  const updates: any = {};
  let confidence = 40;
  
  let name = card.card_name || '';
  
  // Extract year from name
  const { year, cleaned: nameWithoutYear } = extractYear(name);
  if (year) {
    updates.year = year;
    name = nameWithoutYear;
    notes.extractedYear = year;
    confidence += 15;
  }
  
  // Extract variant
  const { variant, cleaned: nameWithoutVariant } = extractVariant(name);
  if (variant) {
    updates.variant = variant;
    notes.extractedVariant = variant;
  }
  
  // Clean name and remove junk tokens
  const { cleaned: cleanedName, removed } = removeJunkTokens(name);
  if (cleanedName !== card.card_name) {
    updates.card_name = cleanedName;
    updates.player_name = cleanedName; // For sports, name is usually player name
    notes.removedTokens = removed;
  }
  
  // Process card number
  if (card.card_number) {
    const numMatch = card.card_number.match(/(?:#|No\.?\s*)?(\d+)/);
    if (numMatch) {
      updates.card_number = numMatch[1];
    }
  }
  
  // Extract manufacturer from set or sport_type
  const manufacturers = ['panini', 'topps', 'upper deck', 'donruss', 'bowman', 'fleer', 'leaf'];
  const searchText = `${card.card_set || ''} ${card.sport_type || ''}`.toLowerCase();
  for (const mfr of manufacturers) {
    if (searchText.includes(mfr)) {
      updates.manufacturer = mfr.charAt(0).toUpperCase() + mfr.slice(1);
      notes.extractedManufacturer = updates.manufacturer;
      confidence += 10;
      break;
    }
  }
  
  // Calculate confidence
  if (updates.year) confidence += 10;
  if (card.card_set) confidence += 10;
  if (card.card_number || updates.card_number) confidence += 10;
  if (updates.manufacturer) confidence += 5;
  
  return { updates, confidence: Math.min(confidence, 85), notes };
}

// Main normalization function
function normalizeCard(card: any): { updates: any; confidence: number; notes: any } {
  const gameType = (card.game_type || card.sport_type || '').toLowerCase();
  
  if (gameType.includes('magic') || gameType.includes('mtg')) {
    return normalizeMTG(card);
  } else if (gameType.includes('pokemon') || gameType.includes('pokémon')) {
    return normalizePokemon(card);
  } else if (gameType.includes('yugioh') || gameType.includes('yu-gi-oh')) {
    return normalizeYuGiOh(card);
  } else if (gameType.includes('sports') || gameType.includes('football') || 
             gameType.includes('baseball') || gameType.includes('basketball') ||
             gameType.includes('hockey') || gameType.includes('soccer') ||
             card.sport_type) {
    return normalizeSports(card);
  }
  
  // Default: apply basic cleanup
  const { cleaned, removed } = removeJunkTokens(card.card_name || '');
  return {
    updates: cleaned !== card.card_name ? { card_name: cleaned } : {},
    confidence: 60,
    notes: { game: 'unknown', removedTokens: removed }
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const {
      limit = 200,
      game = null,
      onlyIf = 'not_normalized',
      minConfidence = 80,
    } = body;

    console.log(`Normalize request: limit=${limit}, game=${game}, onlyIf=${onlyIf}`);

    // Build query
    let query = supabase
      .from('cards')
      .select('*')
      .eq('user_id', user.id)
      .limit(limit);

    // Filter by normalization status
    if (onlyIf === 'not_normalized') {
      query = query.is('normalized_at', null);
    } else if (onlyIf === 'low_confidence') {
      query = query.lt('normalization_confidence', minConfidence);
    }

    // Filter by game
    if (game && game !== 'all') {
      if (game === 'sports') {
        query = query.or('game_type.ilike.%sports%,sport_type.not.is.null');
      } else if (game === 'mtg') {
        query = query.or('game_type.ilike.%magic%,game_type.ilike.%mtg%,sport_type.ilike.%magic%');
      } else if (game === 'pokemon') {
        query = query.or('game_type.ilike.%pokemon%,sport_type.ilike.%pokemon%');
      } else if (game === 'yugioh') {
        query = query.or('game_type.ilike.%yugioh%,game_type.ilike.%yu-gi-oh%');
      }
    }

    const { data: cards, error: queryError } = await query;

    if (queryError) throw queryError;

    if (!cards || cards.length === 0) {
      return new Response(JSON.stringify({
        processed: 0,
        updated: 0,
        skipped: 0,
        flagged: 0,
        results: [],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${cards.length} cards to normalize`);

    const results: any[] = [];
    let updated = 0;
    let skipped = 0;
    let flagged = 0;

    for (const card of cards) {
      try {
        // Store raw values if not already set
        const rawUpdates: any = {};
        if (!card.raw_name && card.card_name) rawUpdates.raw_name = card.card_name;
        if (!card.raw_set && card.card_set) rawUpdates.raw_set = card.card_set;
        if (!card.raw_number && card.card_number) rawUpdates.raw_number = card.card_number;

        // Normalize the card
        const { updates, confidence, notes } = normalizeCard(card);
        
        // Determine if we should flag for review
        const shouldFlag = confidence < 60;
        
        // Prepare final updates
        const finalUpdates: any = {
          ...rawUpdates,
          ...updates,
          normalized_at: new Date().toISOString(),
          normalization_confidence: confidence,
          normalization_notes: notes,
        };
        
        // Flag low confidence cards
        if (shouldFlag && (!card.image_status || card.image_status === 'missing')) {
          finalUpdates.image_status = 'needs_review';
          flagged++;
        }

        // Only update if there are actual changes
        const hasChanges = Object.keys(updates).length > 0 || Object.keys(rawUpdates).length > 0;
        
        if (hasChanges) {
          await supabase
            .from('cards')
            .update(finalUpdates)
            .eq('id', card.id);
          updated++;
        } else {
          // Still mark as normalized
          await supabase
            .from('cards')
            .update({
              normalized_at: new Date().toISOString(),
              normalization_confidence: confidence,
              normalization_notes: notes,
            })
            .eq('id', card.id);
          skipped++;
        }

        results.push({
          id: card.id,
          name: card.card_name,
          newName: updates.card_name || card.card_name,
          game: notes.game,
          confidence,
          changes: Object.keys(updates),
          flagged: shouldFlag,
        });

      } catch (error: any) {
        console.error(`Error normalizing card ${card.id}:`, error);
        results.push({
          id: card.id,
          name: card.card_name,
          error: error.message,
        });
      }
    }

    console.log(`Normalization complete: updated=${updated}, skipped=${skipped}, flagged=${flagged}`);

    return new Response(JSON.stringify({
      processed: results.length,
      updated,
      skipped,
      flagged,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Normalize error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
