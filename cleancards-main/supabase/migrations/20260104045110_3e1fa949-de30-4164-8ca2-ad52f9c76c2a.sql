-- ESSENTIAL: Add printing_key for duplicate prevention + search indexes

-- 1. Add new columns for printing key components (nullable, no breaking changes)
ALTER TABLE public.cards 
ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en',
ADD COLUMN IF NOT EXISTS finish TEXT DEFAULT 'normal';

-- 2. Add computed printing_key column (deterministic, allows duplicates check)
ALTER TABLE public.cards 
ADD COLUMN IF NOT EXISTS printing_key TEXT GENERATED ALWAYS AS (
  COALESCE(LOWER(game_type), 'unknown') || '|' ||
  COALESCE(LOWER(set_code), LOWER(card_set), 'unknown') || '|' ||
  COALESCE(LOWER(card_number), 'unknown') || '|' ||
  COALESCE(LOWER(edition), 'standard') || '|' ||
  COALESCE(LOWER(variant), 'base') || '|' ||
  COALESCE(LOWER(language), 'en') || '|' ||
  COALESCE(LOWER(finish), 'normal')
) STORED;

-- 3. Add quantity column for simple count tracking
ALTER TABLE public.cards
ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1;

-- 4. Index for fast duplicate lookup per user
CREATE INDEX IF NOT EXISTS idx_cards_user_printing_key 
ON public.cards(user_id, printing_key);

-- 5. Enable trigram extension for fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 6. Trigram index for fuzzy name search
CREATE INDEX IF NOT EXISTS idx_cards_name_trigram 
ON public.cards USING gin(card_name gin_trgm_ops);

-- 7. Full-text search index
CREATE INDEX IF NOT EXISTS idx_cards_fulltext 
ON public.cards USING gin(
  to_tsvector('english', 
    COALESCE(card_name, '') || ' ' || 
    COALESCE(card_set, '') || ' ' || 
    COALESCE(player_name, '') || ' ' ||
    COALESCE(team, '')
  )
);