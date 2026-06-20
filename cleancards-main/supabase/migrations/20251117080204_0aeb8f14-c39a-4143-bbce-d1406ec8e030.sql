-- Fix INSERT policies - they should use WITH CHECK, not USING

-- Drop and recreate INSERT policy for cards
DROP POLICY IF EXISTS "authenticated_users_insert_own_cards" ON public.cards;
CREATE POLICY "authenticated_users_insert_own_cards"
ON public.cards FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Drop and recreate INSERT policy for price_alerts
DROP POLICY IF EXISTS "authenticated_users_insert_own_price_alerts" ON public.price_alerts;
CREATE POLICY "authenticated_users_insert_own_price_alerts"
ON public.price_alerts FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Drop and recreate INSERT policy for scan_sessions
DROP POLICY IF EXISTS "authenticated_users_insert_own_scan_sessions" ON public.scan_sessions;
CREATE POLICY "authenticated_users_insert_own_scan_sessions"
ON public.scan_sessions FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Drop and recreate INSERT policy for saved_filters
DROP POLICY IF EXISTS "authenticated_users_insert_own_saved_filters" ON public.saved_filters;
CREATE POLICY "authenticated_users_insert_own_saved_filters"
ON public.saved_filters FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Drop and recreate INSERT policy for price_history
DROP POLICY IF EXISTS "authenticated_users_insert_own_price_history" ON public.price_history;
CREATE POLICY "authenticated_users_insert_own_price_history"
ON public.price_history FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.cards
    WHERE cards.id = price_history.card_id
    AND cards.user_id = auth.uid()
  )
);

-- Drop and recreate INSERT policy for profiles
DROP POLICY IF EXISTS "authenticated_users_insert_own_profile" ON public.profiles;
CREATE POLICY "authenticated_users_insert_own_profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);