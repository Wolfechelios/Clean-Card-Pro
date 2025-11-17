-- Fix storage RLS policies for card-images bucket

-- Drop existing policies if any
DROP POLICY IF EXISTS "Authenticated users can upload card images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update card images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete card images" ON storage.objects;
DROP POLICY IF EXISTS "Public read access to card images" ON storage.objects;

-- Allow authenticated users to upload images to their own folder or cards folder
CREATE POLICY "Authenticated users can upload card images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'card-images' 
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] = 'cards'
  )
);

-- Allow authenticated users to update their own images
CREATE POLICY "Authenticated users can update card images"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'card-images'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] = 'cards'
  )
)
WITH CHECK (
  bucket_id = 'card-images'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] = 'cards'
  )
);

-- Allow authenticated users to delete their own images
CREATE POLICY "Authenticated users can delete card images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'card-images'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR (storage.foldername(name))[1] = 'cards'
  )
);

-- Allow public read access to all card images
CREATE POLICY "Public read access to card images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'card-images');