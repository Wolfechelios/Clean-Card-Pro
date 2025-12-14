-- Add raw import fields for preserving original data
ALTER TABLE public.cards 
ADD COLUMN IF NOT EXISTS raw_name text,
ADD COLUMN IF NOT EXISTS raw_set text,
ADD COLUMN IF NOT EXISTS raw_number text,
ADD COLUMN IF NOT EXISTS raw_year text,
ADD COLUMN IF NOT EXISTS raw_manufacturer text;

-- Add normalization tracking fields
ALTER TABLE public.cards 
ADD COLUMN IF NOT EXISTS normalized_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS normalization_notes jsonb,
ADD COLUMN IF NOT EXISTS normalization_confidence integer;

-- Add additional normalized fields
ALTER TABLE public.cards 
ADD COLUMN IF NOT EXISTS set_name text,
ADD COLUMN IF NOT EXISTS year integer,
ADD COLUMN IF NOT EXISTS manufacturer text,
ADD COLUMN IF NOT EXISTS variant text,
ADD COLUMN IF NOT EXISTS player_name text,
ADD COLUMN IF NOT EXISTS team text,
ADD COLUMN IF NOT EXISTS sport text;

-- Create index for normalization queries
CREATE INDEX IF NOT EXISTS idx_cards_normalization 
ON public.cards (normalized_at, normalization_confidence) 
WHERE normalized_at IS NULL OR normalization_confidence < 80;