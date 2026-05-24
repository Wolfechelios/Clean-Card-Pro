
-- 1. Tighten graded_pricing_cache: drop write policies for any authenticated user
DROP POLICY IF EXISTS "Authenticated can delete pricing cache" ON public.graded_pricing_cache;
DROP POLICY IF EXISTS "Authenticated can update pricing cache" ON public.graded_pricing_cache;
DROP POLICY IF EXISTS "Authenticated can write pricing cache" ON public.graded_pricing_cache;
-- SELECT policy retained: authenticated users can read shared cache.
-- Writes are now only possible via service_role (which bypasses RLS).

-- 2. Tighten price_cache: drop the overly broad ALL policy
DROP POLICY IF EXISTS "Service role can manage price cache" ON public.price_cache;
-- SELECT policy retained for authenticated users.
-- Writes are only possible via service_role.

-- 3. Allow users to delete their own webhook logs
CREATE POLICY "Users can delete their own webhook logs"
  ON public.n8n_webhook_logs
  FOR DELETE
  USING (auth.uid() = user_id);

-- 4. Revoke direct EXECUTE on SECURITY DEFINER helpers from API roles.
--    These are called by RLS policies (which run as definer) and triggers,
--    not directly by clients.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated, public;
