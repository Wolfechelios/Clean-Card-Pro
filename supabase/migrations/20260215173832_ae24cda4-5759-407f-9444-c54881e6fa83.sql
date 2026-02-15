
-- Make the card-images bucket public
UPDATE storage.buckets SET public = true WHERE id = 'card-images';
