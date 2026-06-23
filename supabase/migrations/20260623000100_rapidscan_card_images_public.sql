-- RapidScan Google Lens fallback needs Google to read the uploaded scan image by URL.
-- The app only stores scans under the card-images bucket, and object read access is already public in older migrations.
-- This migration hardens the bucket flag so getPublicUrl() always returns a usable public object URL.
UPDATE storage.buckets
SET public = true
WHERE id = 'card-images';
