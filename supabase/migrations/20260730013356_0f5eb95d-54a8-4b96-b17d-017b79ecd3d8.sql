-- 1. Storage: remove over-permissive insert + listing policies
DROP POLICY IF EXISTS "card_images_rapid_scan_insert" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload card images" ON storage.objects;
DROP POLICY IF EXISTS "Public can read card images" ON storage.objects;
DROP POLICY IF EXISTS "card_images_authenticated_read" ON storage.objects;

CREATE POLICY "card_images_owner_read"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'card-images'
  AND (
    (storage.foldername(name))[1] = (auth.uid())::text
    OR (
      (storage.foldername(name))[1] = ANY (ARRAY['cards','binder'])
      AND public.is_card_owner_path(name)
    )
  )
);

-- 2. Reference tables: require authentication
DROP POLICY IF EXISTS "Anyone can read card cache" ON public.card_print_cache;
CREATE POLICY "Authenticated users can read card cache"
ON public.card_print_cache FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Anyone can view grader premiums" ON public.grader_premiums;
CREATE POLICY "Authenticated users can view grader premiums"
ON public.grader_premiums FOR SELECT
TO authenticated
USING (true);

-- 3. Price caches: scope explicitly to authenticated role
DROP POLICY IF EXISTS "Authenticated users can read price cache" ON public.price_cache;
CREATE POLICY "Authenticated users can read price cache"
ON public.price_cache FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Authenticated users can read pricing cache" ON public.graded_pricing_cache;
CREATE POLICY "Authenticated users can read pricing cache"
ON public.graded_pricing_cache FOR SELECT
TO authenticated
USING (true);

REVOKE SELECT ON public.card_print_cache FROM anon;
REVOKE SELECT ON public.grader_premiums FROM anon;
REVOKE SELECT ON public.price_cache FROM anon;
REVOKE SELECT ON public.graded_pricing_cache FROM anon;