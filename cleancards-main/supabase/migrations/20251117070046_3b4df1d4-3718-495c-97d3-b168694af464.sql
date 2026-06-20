-- Clean up duplicate policies and fix remaining issues

-- Drop old duplicate policies
DROP POLICY IF EXISTS "Users can view own cards" ON public.cards;
DROP POLICY IF EXISTS "Users can insert own cards" ON public.cards;
DROP POLICY IF EXISTS "Users can update own cards" ON public.cards;
DROP POLICY IF EXISTS "Users can delete own cards" ON public.cards;

DROP POLICY IF EXISTS "Users can view own alerts" ON public.price_alerts;
DROP POLICY IF EXISTS "Users can create own alerts" ON public.price_alerts;
DROP POLICY IF EXISTS "Users can update own alerts" ON public.price_alerts;
DROP POLICY IF EXISTS "Users can delete own alerts" ON public.price_alerts;

DROP POLICY IF EXISTS "Users can view own scan sessions" ON public.scan_sessions;
DROP POLICY IF EXISTS "Users can insert own scan sessions" ON public.scan_sessions;
DROP POLICY IF EXISTS "Users can update own scan sessions" ON public.scan_sessions;
DROP POLICY IF EXISTS "Users can delete own scan sessions" ON public.scan_sessions;

DROP POLICY IF EXISTS "Users can view own filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Users can create own filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Users can update own filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Users can delete own filters" ON public.saved_filters;

DROP POLICY IF EXISTS "Users can view price history of own cards" ON public.price_history;
DROP POLICY IF EXISTS "Users can insert price history for own cards" ON public.price_history;

-- Add UPDATE and DELETE policies for price_history to prevent data manipulation
CREATE POLICY "Users can update price history for their own cards"
ON public.price_history FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.cards
    WHERE cards.id = price_history.card_id
    AND cards.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete price history for their own cards"
ON public.price_history FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.cards
    WHERE cards.id = price_history.card_id
    AND cards.user_id = auth.uid()
  )
);

-- Revoke all public access to tables (this is the key to fixing public readability)
REVOKE ALL ON public.profiles FROM anon, authenticated;
REVOKE ALL ON public.cards FROM anon, authenticated;
REVOKE ALL ON public.price_alerts FROM anon, authenticated;
REVOKE ALL ON public.scan_sessions FROM anon, authenticated;
REVOKE ALL ON public.saved_filters FROM anon, authenticated;
REVOKE ALL ON public.price_history FROM anon, authenticated;

-- Grant only necessary permissions back to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_alerts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_filters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_history TO authenticated;

-- Ensure anon has NO permissions (RLS will enforce this, but explicit is better)
-- No GRANT statements for anon role on these tables