
-- Fix storage UPDATE policy to have ownership-scoped WITH CHECK
DROP POLICY IF EXISTS "card_images_owner_update" ON storage.objects;
CREATE POLICY "card_images_owner_update" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'card-images' AND EXISTS (
    SELECT 1 FROM public.cards
    WHERE cards.user_id = auth.uid() AND cards.image_storage_path = name
  )
)
WITH CHECK (
  bucket_id = 'card-images' AND EXISTS (
    SELECT 1 FROM public.cards
    WHERE cards.user_id = auth.uid() AND cards.image_storage_path = name
  )
);

-- Enable pgcrypto for future API key encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;
