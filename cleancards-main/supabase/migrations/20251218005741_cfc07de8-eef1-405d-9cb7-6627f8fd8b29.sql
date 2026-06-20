-- Add CGC 10 price column to cards table
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS cgc10_price numeric;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS cgc10_updated_at timestamp with time zone;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS cgc10_source text;