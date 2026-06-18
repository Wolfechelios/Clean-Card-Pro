-- Rapid Scan currently uploads a queued capture before the card row exists.
-- The strict owner policy introduced in 20260524211149 requires cards/<uuid>.jpg
-- to reference an existing card row, so pre-insert uploads fail RLS.
-- Permit authenticated users to create new queued objects in the legacy cards
-- folder while preserving owner-scoped update/delete rules.

DROP POLICY IF EXISTS card_images_rapid_scan_insert ON storage.objects;

CREATE POLICY card_images_rapid_scan_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'card-images'
  AND (storage.foldername(name))[1] = 'cards'
  AND public.path_card_id(name) IS NOT NULL
);

-- Reassert the cards insert rule used by Save Mode.
DROP POLICY IF EXISTS "Users can insert their own cards" ON public.cards;
CREATE POLICY "Users can insert their own cards"
ON public.cards
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);
