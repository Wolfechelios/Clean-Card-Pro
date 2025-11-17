-- Fix RLS policies to ensure proper authentication enforcement
-- Issue: Tables have RLS enabled but may allow unauthenticated access

-- Profiles table: Ensure only authenticated users can view their own profile
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- Cards table: Ensure only authenticated users can access their own cards
DROP POLICY IF EXISTS "Users can view their own cards" ON public.cards;
CREATE POLICY "Users can view their own cards"
ON public.cards FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own cards" ON public.cards;
CREATE POLICY "Users can insert their own cards"
ON public.cards FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own cards" ON public.cards;
CREATE POLICY "Users can update their own cards"
ON public.cards FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own cards" ON public.cards;
CREATE POLICY "Users can delete their own cards"
ON public.cards FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Price alerts: Restrict to authenticated users only
DROP POLICY IF EXISTS "Users can manage their own price alerts" ON public.price_alerts;
CREATE POLICY "Users can view their own price alerts"
ON public.price_alerts FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own price alerts"
ON public.price_alerts FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own price alerts"
ON public.price_alerts FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own price alerts"
ON public.price_alerts FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Scan sessions: Restrict to authenticated users only
DROP POLICY IF EXISTS "Users can view their own scan sessions" ON public.scan_sessions;
CREATE POLICY "Users can view their own scan sessions"
ON public.scan_sessions FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own scan sessions" ON public.scan_sessions;
CREATE POLICY "Users can insert their own scan sessions"
ON public.scan_sessions FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own scan sessions" ON public.scan_sessions;
CREATE POLICY "Users can update their own scan sessions"
ON public.scan_sessions FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own scan sessions" ON public.scan_sessions;
CREATE POLICY "Users can delete their own scan sessions"
ON public.scan_sessions FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Saved filters: Restrict to authenticated users only
DROP POLICY IF EXISTS "Users can manage their own filters" ON public.saved_filters;
CREATE POLICY "Users can view their own saved filters"
ON public.saved_filters FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own saved filters"
ON public.saved_filters FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own saved filters"
ON public.saved_filters FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own saved filters"
ON public.saved_filters FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Price history: Restrict to authenticated users who own the associated cards
DROP POLICY IF EXISTS "Users can view price history for their cards" ON public.price_history;
CREATE POLICY "Users can view price history for their cards"
ON public.price_history FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.cards
    WHERE cards.id = price_history.card_id
    AND cards.user_id = auth.uid()
  )
);

-- Fix function search paths for security
DROP FUNCTION IF EXISTS public.update_updated_at_column() CASCADE;
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Recreate triggers that were dropped by CASCADE
CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_cards_updated_at
BEFORE UPDATE ON public.cards
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();