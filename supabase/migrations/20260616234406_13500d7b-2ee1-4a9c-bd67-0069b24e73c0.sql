
-- Lock down passkey_challenges: only service role should ever access it.
-- Explicit deny policy makes the intent clear and satisfies RLS-no-policy linter.
REVOKE ALL ON public.passkey_challenges FROM anon, authenticated;
CREATE POLICY "Deny all client access to passkey challenges"
  ON public.passkey_challenges
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Allow authenticated users to register their own passkeys.
CREATE POLICY "Users insert own passkeys"
  ON public.user_passkeys
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
