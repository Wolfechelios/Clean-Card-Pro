-- Fix: Remove overly permissive public SELECT policy on graded_pricing_cache
-- This prevents competitors from scraping pricing data

-- Drop the current overly permissive policy
DROP POLICY IF EXISTS "Anyone can read pricing cache" ON public.graded_pricing_cache;

-- Create a new policy that requires authentication
CREATE POLICY "Authenticated users can read pricing cache" 
ON public.graded_pricing_cache 
FOR SELECT 
USING (auth.uid() IS NOT NULL);