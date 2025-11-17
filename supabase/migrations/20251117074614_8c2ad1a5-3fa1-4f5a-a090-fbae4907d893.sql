-- Clean up duplicate policies and fix remaining issues

-- Drop ALL existing policies on all tables to start fresh
DROP POLICY IF EXISTS "Users can view own cards" ON public.cards;
DROP POLICY IF EXISTS "Users can insert own cards" ON public.cards;
DROP POLICY IF EXISTS "Users can update own cards" ON public.cards;
DROP POLICY IF EXISTS "Users can delete own cards" ON public.cards;
DROP POLICY IF EXISTS "Users can view their own cards" ON public.cards;
DROP POLICY IF EXISTS "Users can insert their own cards" ON public.cards;
DROP POLICY IF EXISTS "Users can update their own cards" ON public.cards;
DROP POLICY IF EXISTS "Users can delete their own cards" ON public.cards;
DROP POLICY IF EXISTS "Block anonymous access to cards" ON public.cards;

DROP POLICY IF EXISTS "Users can view own alerts" ON public.price_alerts;
DROP POLICY IF EXISTS "Users can create own alerts" ON public.price_alerts;
DROP POLICY IF EXISTS "Users can update own alerts" ON public.price_alerts;
DROP POLICY IF EXISTS "Users can delete own alerts" ON public.price_alerts;
DROP POLICY IF EXISTS "Users can view their own price alerts" ON public.price_alerts;
DROP POLICY IF EXISTS "Users can insert their own price alerts" ON public.price_alerts;
DROP POLICY IF EXISTS "Users can update their own price alerts" ON public.price_alerts;
DROP POLICY IF EXISTS "Users can delete their own price alerts" ON public.price_alerts;
DROP POLICY IF EXISTS "Block anonymous access to price_alerts" ON public.price_alerts;

DROP POLICY IF EXISTS "Users can view own scan sessions" ON public.scan_sessions;
DROP POLICY IF EXISTS "Users can insert own scan sessions" ON public.scan_sessions;
DROP POLICY IF EXISTS "Users can update own scan sessions" ON public.scan_sessions;
DROP POLICY IF EXISTS "Users can delete own scan sessions" ON public.scan_sessions;
DROP POLICY IF EXISTS "Users can view their own scan sessions" ON public.scan_sessions;
DROP POLICY IF EXISTS "Users can insert their own scan sessions" ON public.scan_sessions;
DROP POLICY IF EXISTS "Users can update their own scan sessions" ON public.scan_sessions;
DROP POLICY IF EXISTS "Users can delete their own scan sessions" ON public.scan_sessions;
DROP POLICY IF EXISTS "Block anonymous access to scan_sessions" ON public.scan_sessions;

DROP POLICY IF EXISTS "Users can view own filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Users can create own filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Users can update own filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Users can delete own filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Users can view their own saved filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Users can insert their own saved filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Users can update their own saved filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Users can delete their own saved filters" ON public.saved_filters;
DROP POLICY IF EXISTS "Block anonymous access to saved_filters" ON public.saved_filters;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Block anonymous access to profiles" ON public.profiles;

DROP POLICY IF EXISTS "Users can view price history of own cards" ON public.price_history;
DROP POLICY IF EXISTS "Users can insert price history for own cards" ON public.price_history;
DROP POLICY IF EXISTS "Users can view price history for their cards" ON public.price_history;
DROP POLICY IF EXISTS "Users can update price history for their own cards" ON public.price_history;
DROP POLICY IF EXISTS "Users can delete price history for their own cards" ON public.price_history;
DROP POLICY IF EXISTS "Block anonymous access to price_history" ON public.price_history;

-- Now create clean, consistent policies for all tables

-- Profiles table
CREATE POLICY "authenticated_users_select_own_profile"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = id);

CREATE POLICY "authenticated_users_insert_own_profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

CREATE POLICY "authenticated_users_update_own_profile"
ON public.profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id);

-- Cards table
CREATE POLICY "authenticated_users_select_own_cards"
ON public.cards FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "authenticated_users_insert_own_cards"
ON public.cards FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "authenticated_users_update_own_cards"
ON public.cards FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "authenticated_users_delete_own_cards"
ON public.cards FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Price alerts table
CREATE POLICY "authenticated_users_select_own_price_alerts"
ON public.price_alerts FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "authenticated_users_insert_own_price_alerts"
ON public.price_alerts FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "authenticated_users_update_own_price_alerts"
ON public.price_alerts FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "authenticated_users_delete_own_price_alerts"
ON public.price_alerts FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Scan sessions table
CREATE POLICY "authenticated_users_select_own_scan_sessions"
ON public.scan_sessions FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "authenticated_users_insert_own_scan_sessions"
ON public.scan_sessions FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "authenticated_users_update_own_scan_sessions"
ON public.scan_sessions FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "authenticated_users_delete_own_scan_sessions"
ON public.scan_sessions FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Saved filters table
CREATE POLICY "authenticated_users_select_own_saved_filters"
ON public.saved_filters FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "authenticated_users_insert_own_saved_filters"
ON public.saved_filters FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "authenticated_users_update_own_saved_filters"
ON public.saved_filters FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "authenticated_users_delete_own_saved_filters"
ON public.saved_filters FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Price history table (including UPDATE and DELETE to prevent manipulation)
CREATE POLICY "authenticated_users_select_own_price_history"
ON public.price_history FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.cards
    WHERE cards.id = price_history.card_id
    AND cards.user_id = auth.uid()
  )
);

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

CREATE POLICY "authenticated_users_update_own_price_history"
ON public.price_history FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.cards
    WHERE cards.id = price_history.card_id
    AND cards.user_id = auth.uid()
  )
);

CREATE POLICY "authenticated_users_delete_own_price_history"
ON public.price_history FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.cards
    WHERE cards.id = price_history.card_id
    AND cards.user_id = auth.uid()
  )
);

-- Revoke all public access and grant only to authenticated users
REVOKE ALL ON public.profiles FROM anon, authenticated;
REVOKE ALL ON public.cards FROM anon, authenticated;
REVOKE ALL ON public.price_alerts FROM anon, authenticated;
REVOKE ALL ON public.scan_sessions FROM anon, authenticated;
REVOKE ALL ON public.saved_filters FROM anon, authenticated;
REVOKE ALL ON public.price_history FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_alerts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scan_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_filters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_history TO authenticated;