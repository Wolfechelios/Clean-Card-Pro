-- Helper: extract a uuid from the filename of a storage path (last segment before the extension)
CREATE OR REPLACE FUNCTION public.path_card_id(_path text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN regexp_replace(split_part(_path, '/', array_length(string_to_array(_path, '/'), 1)), '\.[^.]+$', '') ~ '^[0-9a-fA-F-]{36}$'
    THEN regexp_replace(split_part(_path, '/', array_length(string_to_array(_path, '/'), 1)), '\.[^.]+$', '')::uuid
    ELSE NULL
  END
$$;

-- Helper: is the current user the owner of the card referenced by this storage path?
CREATE OR REPLACE FUNCTION public.is_card_owner_path(_path text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.cards c
    WHERE c.id = public.path_card_id(_path)
      AND c.user_id = auth.uid()
  )
$$;

-- Drop overly-broad policies on storage.objects for card-images
DROP POLICY IF EXISTS "Public read card-images" ON storage.objects;
DROP POLICY IF EXISTS card_images_authenticated_insert ON storage.objects;
DROP POLICY IF EXISTS card_images_authenticated_update ON storage.objects;
DROP POLICY IF EXISTS card_images_authenticated_delete ON storage.objects;

-- Recreate write policies with per-user ownership enforcement
CREATE POLICY card_images_owner_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'card-images'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (
      (storage.foldername(name))[1] IN ('cards', 'binder')
      AND public.is_card_owner_path(name)
    )
  )
);

CREATE POLICY card_images_owner_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'card-images'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (
      (storage.foldername(name))[1] IN ('cards', 'binder')
      AND public.is_card_owner_path(name)
    )
  )
)
WITH CHECK (
  bucket_id = 'card-images'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (
      (storage.foldername(name))[1] IN ('cards', 'binder')
      AND public.is_card_owner_path(name)
    )
  )
);

CREATE POLICY card_images_owner_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'card-images'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (
      (storage.foldername(name))[1] IN ('cards', 'binder')
      AND public.is_card_owner_path(name)
    )
  )
);