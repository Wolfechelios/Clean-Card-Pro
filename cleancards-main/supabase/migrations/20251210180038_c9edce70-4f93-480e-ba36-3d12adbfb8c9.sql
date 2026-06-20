-- Grader premium multipliers (admin configurable)
CREATE TABLE public.grader_premiums (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  grader TEXT NOT NULL UNIQUE,
  grade TEXT NOT NULL,
  premium_multiplier NUMERIC NOT NULL DEFAULT 1.0,
  notes TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add unique constraint for grader+grade combination
ALTER TABLE public.grader_premiums DROP CONSTRAINT IF EXISTS grader_premiums_grader_key;
ALTER TABLE public.grader_premiums ADD CONSTRAINT grader_premiums_grader_grade_key UNIQUE (grader, grade);

-- Enable RLS
ALTER TABLE public.grader_premiums ENABLE ROW LEVEL SECURITY;

-- Public read access (pricing data is public reference)
CREATE POLICY "Anyone can view grader premiums" ON public.grader_premiums FOR SELECT USING (true);

-- Only authenticated users can modify (admin feature)
CREATE POLICY "Authenticated users can insert grader premiums" ON public.grader_premiums FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update grader premiums" ON public.grader_premiums FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete grader premiums" ON public.grader_premiums FOR DELETE USING (auth.uid() IS NOT NULL);

-- Pricing cache table
CREATE TABLE public.graded_pricing_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  card_identifier JSONB NOT NULL,
  grader TEXT,
  grade TEXT,
  response_data JSONB NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.graded_pricing_cache ENABLE ROW LEVEL SECURITY;

-- Public read for cache (allows edge function to check)
CREATE POLICY "Anyone can read pricing cache" ON public.graded_pricing_cache FOR SELECT USING (true);
CREATE POLICY "Authenticated can write pricing cache" ON public.graded_pricing_cache FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can update pricing cache" ON public.graded_pricing_cache FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can delete pricing cache" ON public.graded_pricing_cache FOR DELETE USING (auth.uid() IS NOT NULL);

-- Insert default grader premiums
INSERT INTO public.grader_premiums (grader, grade, premium_multiplier, notes) VALUES
  ('PSA', '10', 1.0, 'Gem Mint - baseline'),
  ('PSA', '9.5', 0.85, 'N/A for PSA'),
  ('PSA', '9', 0.45, 'Mint'),
  ('PSA', '8', 0.25, 'NM-MT'),
  ('PSA', '7', 0.15, 'NM'),
  ('BGS', '10', 1.15, 'Pristine - premium over PSA'),
  ('BGS', '9.5', 0.95, 'Gem Mint'),
  ('BGS', '9', 0.40, 'Mint'),
  ('BGS', '8.5', 0.30, 'NM-MT+'),
  ('BGS', '8', 0.22, 'NM-MT'),
  ('CGC', '10', 0.90, 'Perfect - slight discount to PSA'),
  ('CGC', '9.5', 0.80, 'Gem Mint'),
  ('CGC', '9', 0.38, 'Mint'),
  ('CGC', '8.5', 0.28, 'NM-MT+'),
  ('CGC', '8', 0.20, 'NM-MT')
ON CONFLICT (grader, grade) DO NOTHING;

-- Index for cache lookups
CREATE INDEX idx_graded_pricing_cache_key ON public.graded_pricing_cache (cache_key);
CREATE INDEX idx_graded_pricing_cache_expires ON public.graded_pricing_cache (expires_at);