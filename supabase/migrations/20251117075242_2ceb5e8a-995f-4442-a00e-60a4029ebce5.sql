-- Fix remaining security issues

-- Remove email column from profiles (it's already in auth.users)
ALTER TABLE public.profiles DROP COLUMN IF EXISTS email;

-- Add DELETE policy for profiles (GDPR compliance)
CREATE POLICY "authenticated_users_delete_own_profile"
ON public.profiles FOR DELETE
TO authenticated
USING (auth.uid() = id);

-- Drop and recreate UPDATE policies with WITH CHECK conditions

-- Cards UPDATE policy with WITH CHECK
DROP POLICY IF EXISTS "authenticated_users_update_own_cards" ON public.cards;
CREATE POLICY "authenticated_users_update_own_cards"
ON public.cards FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Price alerts UPDATE policy with WITH CHECK
DROP POLICY IF EXISTS "authenticated_users_update_own_price_alerts" ON public.price_alerts;
CREATE POLICY "authenticated_users_update_own_price_alerts"
ON public.price_alerts FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Scan sessions UPDATE policy with WITH CHECK
DROP POLICY IF EXISTS "authenticated_users_update_own_scan_sessions" ON public.scan_sessions;
CREATE POLICY "authenticated_users_update_own_scan_sessions"
ON public.scan_sessions FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Saved filters UPDATE policy with WITH CHECK
DROP POLICY IF EXISTS "authenticated_users_update_own_saved_filters" ON public.saved_filters;
CREATE POLICY "authenticated_users_update_own_saved_filters"
ON public.saved_filters FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Price history UPDATE policy with WITH CHECK
DROP POLICY IF EXISTS "authenticated_users_update_own_price_history" ON public.price_history;
CREATE POLICY "authenticated_users_update_own_price_history"
ON public.price_history FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.cards
    WHERE cards.id = price_history.card_id
    AND cards.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.cards
    WHERE cards.id = price_history.card_id
    AND cards.user_id = auth.uid()
  )
);