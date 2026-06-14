import { supabase } from "@/integrations/supabase/client";

/**
 * Extract the storage object path from any card-images URL (signed or public).
 */
function extractStoragePath(url: string): string | null {
  if (!url) return null;
  const signed = url.match(/\/object\/sign\/card-images\/(.+?)(?:\?|$)/);
  if (signed) return signed[1];
  const pub = url.match(/\/object\/public\/card-images\/(.+?)(?:\?|$)/);
  if (pub) return pub[1];
  const authenticated = url.match(/\/object\/authenticated\/card-images\/(.+?)(?:\?|$)/);
  if (authenticated) return authenticated[1];
  return null;
}

/**
 * Returns the permanent public URL for a file in the card-images bucket.
 */
export async function getSignedImageUrl(filePath: string): Promise<string> {
  return getPublicImageUrl(filePath);
}

/**
 * Convert any card-images URL (signed/public/authenticated/expired) to its permanent public URL.
 * If the URL is not a card-images URL, return it unchanged.
 */
export async function toSignedImageUrl(url: string): Promise<string> {
  if (!url) return url;
  const path = extractStoragePath(url);
  if (!path) return url;
  return getPublicImageUrl(path);
}

/**
 * Synchronous variant for legacy call sites: returns the original URL
 * immediately and kicks off a background sign so subsequent calls are cached.
 * Prefer `toSignedImageUrl` (async) wherever possible.
 */
export function toPublicImageUrl(url: string): string {
  if (!url) return url;
  const path = extractStoragePath(url);
  if (!path) return url;
  return getPublicImageUrl(path);
}

/**
 * Returns the permanent public URL for a stored card image.
 */
export function getPublicImageUrl(filePath: string): string {
  const { data } = supabase.storage.from("card-images").getPublicUrl(filePath);
  return data.publicUrl;
}
