-- Simplify storage policies - allow all authenticated users to upload to card-images

DROP POLICY IF EXISTS "card_images_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "card_images_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "card_images_auth_delete" ON storage.objects;

-- Allow authenticated users to upload anywhere in card-images bucket
CREATE POLICY "card_images_auth_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'card-images');

-- Allow authenticated users to update their uploads
CREATE POLICY "card_images_auth_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'card-images')
WITH CHECK (bucket_id = 'card-images');

-- Allow authenticated users to delete their uploads
CREATE POLICY "card_images_auth_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'card-images');