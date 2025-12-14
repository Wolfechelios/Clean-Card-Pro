-- Add new columns for image management to cards table
ALTER TABLE public.cards 
ADD COLUMN IF NOT EXISTS external_id text,
ADD COLUMN IF NOT EXISTS external_source text,
ADD COLUMN IF NOT EXISTS image_status text DEFAULT 'missing',
ADD COLUMN IF NOT EXISTS image_last_attempt_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS image_error text;

-- Create index for efficient backfill queries
CREATE INDEX IF NOT EXISTS idx_cards_image_backfill 
ON public.cards (game_type, image_status) 
WHERE image_url IS NULL OR image_status IN ('missing', 'failed', 'needs_review');

-- Update existing cards: set image_status based on current image_url
UPDATE public.cards 
SET image_status = CASE 
  WHEN image_url IS NOT NULL AND image_url NOT LIKE '%placehold%' THEN 'ok'
  ELSE 'missing'
END
WHERE image_status IS NULL;