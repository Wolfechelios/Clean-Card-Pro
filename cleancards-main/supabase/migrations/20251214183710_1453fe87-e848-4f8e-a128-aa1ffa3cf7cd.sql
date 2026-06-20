-- Add PSA10 price columns to cards table
ALTER TABLE public.cards
ADD COLUMN IF NOT EXISTS psa10_price numeric,
ADD COLUMN IF NOT EXISTS psa10_currency text DEFAULT 'USD',
ADD COLUMN IF NOT EXISTS psa10_source text,
ADD COLUMN IF NOT EXISTS psa10_updated_at timestamptz,
ADD COLUMN IF NOT EXISTS psa10_match_confidence int,
ADD COLUMN IF NOT EXISTS psa10_source_ref text,
ADD COLUMN IF NOT EXISTS psa10_locked boolean DEFAULT false;

-- Create price_cache table for caching provider responses
CREATE TABLE IF NOT EXISTS public.price_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_hash text UNIQUE NOT NULL,
  source text NOT NULL,
  price numeric,
  currency text DEFAULT 'USD',
  confidence int,
  source_ref text,
  raw jsonb,
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS on price_cache
ALTER TABLE public.price_cache ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read cache (it's shared data)
CREATE POLICY "Authenticated users can read price cache"
ON public.price_cache FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Only service role can write (edge functions)
CREATE POLICY "Service role can manage price cache"
ON public.price_cache FOR ALL
USING (auth.uid() IS NOT NULL);

-- Create price_jobs table for bulk updates
CREATE TABLE IF NOT EXISTS public.price_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  requested_count int DEFAULT 0,
  processed_count int DEFAULT 0,
  error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS on price_jobs
ALTER TABLE public.price_jobs ENABLE ROW LEVEL SECURITY;

-- Users can only see their own jobs
CREATE POLICY "Users can view their own price jobs"
ON public.price_jobs FOR SELECT
USING (auth.uid() = user_id);

-- Users can create their own jobs
CREATE POLICY "Users can create their own price jobs"
ON public.price_jobs FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own jobs
CREATE POLICY "Users can update their own price jobs"
ON public.price_jobs FOR UPDATE
USING (auth.uid() = user_id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_price_cache_identity_hash ON public.price_cache(identity_hash);
CREATE INDEX IF NOT EXISTS idx_price_cache_updated_at ON public.price_cache(updated_at);
CREATE INDEX IF NOT EXISTS idx_price_jobs_user_status ON public.price_jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_cards_psa10_updated ON public.cards(psa10_updated_at);