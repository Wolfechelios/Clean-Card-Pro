-- Make card-images bucket private
UPDATE storage.buckets 
SET public = false 
WHERE id = 'card-images';

-- Drop the public view policy
DROP POLICY IF EXISTS "Anyone can view card images" ON storage.objects;

-- Create a new policy so users can only view their own card images
CREATE POLICY "Users can view their own card images"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'card-images' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);