import { supabase } from "@/integrations/supabase/client";

/**
 * Returns the permanent public URL for a file in the card-images bucket.
 * Since the bucket is public, no signed token is needed — URLs never expire.
 */
export function getPublicImageUrl(filePath: string): string {
  const { data } = supabase.storage.from("card-images").getPublicUrl(filePath);
  return data.publicUrl;
}

/**
 * Converts a potentially-expired signed URL back to a public URL.
 * Handles both signed URLs and already-public URLs.
 */
export function toPublicImageUrl(url: string): string {
  if (!url) return url;

  // Already a public URL
  if (url.includes("/object/public/card-images/")) return url;

  // Signed URL pattern: /object/sign/card-images/cards/xxx.jpg?token=...
  const signedMatch = url.match(/\/object\/sign\/card-images\/(.+?)(?:\?|$)/);
  if (signedMatch) {
    const path = signedMatch[1];
    return getPublicImageUrl(path);
  }

  return url;
}
