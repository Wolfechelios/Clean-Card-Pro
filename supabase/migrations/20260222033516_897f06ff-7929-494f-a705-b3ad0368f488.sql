
-- Drop existing policies that default to PUBLIC
DROP POLICY IF EXISTS "Users can view their own API keys" ON public.user_api_keys;
DROP POLICY IF EXISTS "Users can insert their own API keys" ON public.user_api_keys;
DROP POLICY IF EXISTS "Users can update their own API keys" ON public.user_api_keys;
DROP POLICY IF EXISTS "Users can delete their own API keys" ON public.user_api_keys;

-- Recreate with explicit TO authenticated role
CREATE POLICY "Users can view their own API keys" ON public.user_api_keys
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own API keys" ON public.user_api_keys
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own API keys" ON public.user_api_keys
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own API keys" ON public.user_api_keys
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
