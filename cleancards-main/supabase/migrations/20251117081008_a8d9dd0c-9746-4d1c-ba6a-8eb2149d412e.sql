-- Clean up ALL existing storage policies for card-images bucket
DROP POLICY IF EXISTS "Authenticated users can delete card images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update card images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload card images" ON storage.objects;
DROP POLICY IF EXISTS "Card images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Public read access to card images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own card images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their images and bulk images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own card images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own card images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their images and bulk images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own card images" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload card images" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own card images" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload to their folder and bulk folder" ON storage.objects;
DROP POLICY IF EXISTS "Users can view own card images" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own card images" ON storage.objects;

-- Create clean, non-conflicting policies

-- 1. Public READ access (anyone can view card images)
CREATE POLICY "card_images_public_read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'card-images');

-- 2. Authenticated users can INSERT to cards/ folder
CREATE POLICY "card_images_auth_insert"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'card-images'
  AND (storage.foldername(name))[1] = 'cards'
);

-- 3. Authenticated users can UPDATE their own files in cards/ folder
CREATE POLICY "card_images_auth_update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'card-images' AND (storage.foldername(name))[1] = 'cards')
WITH CHECK (bucket_id = 'card-images' AND (storage.foldername(name))[1] = 'cards');

-- 4. Authenticated users can DELETE from cards/ folder
CREATE POLICY "card_images_auth_delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'card-images' AND (storage.foldername(name))[1] = 'cards');