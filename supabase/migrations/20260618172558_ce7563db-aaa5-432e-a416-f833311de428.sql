-- Lock down passkey_challenges: only service role should ever access it.
REVOKE ALL ON public.passkey_challenges FROM anon, authenticated;
DROP POLICY IF EXISTS "Deny all client access to passkey challenges" ON public.passkey_challenges;
CREATE POLICY "Deny all client access to passkey challenges"
  ON public.passkey_challenges
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Allow authenticated users to register their own passkeys.
DROP POLICY IF EXISTS "Users insert own passkeys" ON public.user_passkeys;
CREATE POLICY "Users insert own passkeys"
  ON public.user_passkeys
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Switch ownership check helper to SECURITY INVOKER.
CREATE OR REPLACE FUNCTION public.is_card_owner_path(_path text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.cards c
    WHERE c.id = public.path_card_id(_path)
      AND c.user_id = auth.uid()
  )
$function$;

-- Allow Rapid Scan to upload queued captures before the card row exists.
DROP POLICY IF EXISTS card_images_rapid_scan_insert ON storage.objects;
CREATE POLICY card_images_rapid_scan_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'card-images'
  AND (storage.foldername(name))[1] = 'cards'
  AND public.path_card_id(name) IS NOT NULL
);

-- Reassert cards insert rule used by Save Mode.
DROP POLICY IF EXISTS "Users can insert their own cards" ON public.cards;
CREATE POLICY "Users can insert their own cards"
ON public.cards
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);