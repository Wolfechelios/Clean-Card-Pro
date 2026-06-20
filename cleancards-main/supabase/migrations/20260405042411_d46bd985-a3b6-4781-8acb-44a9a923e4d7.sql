
-- Drop the overly permissive UPDATE and DELETE policies
DROP POLICY IF EXISTS "card_images_auth_update" ON storage.objects;
DROP POLICY IF EXISTS "card_images_auth_delete" ON storage.objects;

-- Create ownership-based UPDATE policy
-- Users can only update files whose path starts with 'cards/' and contains their card ID
-- Since files are stored as cards/{game}/{card_id}.{ext}, we verify the user owns the card
CREATE POLICY "card_images_owner_update" ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'card-images'
  AND EXISTS (
    SELECT 1 FROM public.cards
    WHERE cards.user_id = auth.uid()
    AND cards.image_storage_path = name
  )
)
WITH CHECK (
  bucket_id = 'card-images'
);

-- Create ownership-based DELETE policy
CREATE POLICY "card_images_owner_delete" ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'card-images'
  AND EXISTS (
    SELECT 1 FROM public.cards
    WHERE cards.user_id = auth.uid()
    AND cards.image_storage_path = name
  )
);
