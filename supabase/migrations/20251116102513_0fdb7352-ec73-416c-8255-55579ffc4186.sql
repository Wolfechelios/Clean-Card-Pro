-- Fix storage policies for card-images bucket

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can upload their own card images" ON storage.objects;
DROP POLICY IF EXISTS "Card images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own card images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own card images" ON storage.objects;

-- Allow authenticated users to upload to their user_id folder or cards folder
CREATE POLICY "Users can upload card images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'card-images' AND
  (
    (storage.foldername(name))[1] = auth.uid()::text OR
    (storage.foldername(name))[1] = 'cards'
  )
);

-- Allow public read access to all card images
CREATE POLICY "Card images are publicly accessible"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'card-images');

-- Allow users to update their own images
CREATE POLICY "Users can update their own card images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'card-images' AND
  (
    (storage.foldername(name))[1] = auth.uid()::text OR
    (storage.foldername(name))[1] = 'cards'
  )
);

-- Allow users to delete their own images
CREATE POLICY "Users can delete their own card images"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'card-images' AND
  (
    (storage.foldername(name))[1] = auth.uid()::text OR
    (storage.foldername(name))[1] = 'cards'
  )
);