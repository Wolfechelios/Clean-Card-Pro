-- Add explicit policies to block anonymous access to all tables
-- This ensures unauthenticated users cannot read any sensitive data

-- Profiles table: Block anonymous access
CREATE POLICY "Block anonymous access to profiles"
ON public.profiles FOR SELECT
TO anon
USING (false);

-- Cards table: Block anonymous access
CREATE POLICY "Block anonymous access to cards"
ON public.cards FOR SELECT
TO anon
USING (false);

-- Price alerts: Block anonymous access
CREATE POLICY "Block anonymous access to price_alerts"
ON public.price_alerts FOR SELECT
TO anon
USING (false);

-- Scan sessions: Block anonymous access
CREATE POLICY "Block anonymous access to scan_sessions"
ON public.scan_sessions FOR SELECT
TO anon
USING (false);

-- Saved filters: Block anonymous access
CREATE POLICY "Block anonymous access to saved_filters"
ON public.saved_filters FOR SELECT
TO anon
USING (false);

-- Price history: Block anonymous access
CREATE POLICY "Block anonymous access to price_history"
ON public.price_history FOR SELECT
TO anon
USING (false);