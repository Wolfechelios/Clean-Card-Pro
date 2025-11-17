-- Fix storage policies to allow bulk folder uploads
-- First, drop existing policies that might conflict
DROP POLICY IF EXISTS "Users can upload images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete images" ON storage.objects;

-- Create comprehensive policies that allow bulk uploads
CREATE POLICY "Users can upload to their folder and bulk folder"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'card-images' AND (
    auth.uid()::text = (storage.foldername(name))[1] OR
    (storage.foldername(name))[1] = 'cards' OR
    (storage.foldername(name))[1] = 'bulk'
  )
);

CREATE POLICY "Users can update their images and bulk images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'card-images' AND (
    auth.uid()::text = (storage.foldername(name))[1] OR
    (storage.foldername(name))[1] = 'cards' OR
    (storage.foldername(name))[1] = 'bulk'
  )
);

CREATE POLICY "Users can delete their images and bulk images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'card-images' AND (
    auth.uid()::text = (storage.foldername(name))[1] OR
    (storage.foldername(name))[1] = 'cards' OR
    (storage.foldername(name))[1] = 'bulk'
  )
);