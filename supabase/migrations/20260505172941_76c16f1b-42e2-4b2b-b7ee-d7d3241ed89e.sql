-- Privatize the bucket
UPDATE storage.buckets SET public = false WHERE id = 'card-images';

-- Drop overly-permissive policies
DROP POLICY IF EXISTS card_images_public_read ON storage.objects;
DROP POLICY IF EXISTS card_images_owner_insert ON storage.objects;
DROP POLICY IF EXISTS card_images_owner_read ON storage.objects;
DROP POLICY IF EXISTS card_images_owner_update ON storage.objects;
DROP POLICY IF EXISTS card_images_owner_delete ON storage.objects;

-- Authenticated-only read, scoped to the cards/ prefix
CREATE POLICY card_images_authenticated_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'card-images'
    AND (storage.foldername(name))[1] = 'cards'
  );

-- Authenticated insert into cards/ prefix
CREATE POLICY card_images_authenticated_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'card-images'
    AND (storage.foldername(name))[1] = 'cards'
  );

-- Authenticated update/delete only on cards/ prefix
CREATE POLICY card_images_authenticated_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'card-images'
    AND (storage.foldername(name))[1] = 'cards'
  )
  WITH CHECK (
    bucket_id = 'card-images'
    AND (storage.foldername(name))[1] = 'cards'
  );

CREATE POLICY card_images_authenticated_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'card-images'
    AND (storage.foldername(name))[1] = 'cards'
  );