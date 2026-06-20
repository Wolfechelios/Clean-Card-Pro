-- Add missing columns for card image search system
-- Check and add columns that don't exist yet

-- Add set_code column for MTG/Pokemon/Yugioh set codes
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS set_code text;

-- Add image_storage_path for Supabase storage path
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS image_storage_path text;

-- Add image_source to track where image came from
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS image_source text;

-- Add image_updated_at for caching
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS image_updated_at timestamptz;

-- Add image_locked to prevent overwrites
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS image_locked boolean DEFAULT false;

-- Add image_search_status for tracking search state
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS image_search_status text DEFAULT 'missing';

-- Create index for finding cards with missing images
CREATE INDEX IF NOT EXISTS idx_cards_image_search_status ON public.cards(image_search_status) WHERE image_search_status = 'missing' OR image_search_status = 'not_found';

-- Create index for image_locked to quickly filter locked images
CREATE INDEX IF NOT EXISTS idx_cards_image_locked ON public.cards(image_locked) WHERE image_locked = true;