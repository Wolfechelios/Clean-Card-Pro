import { supabase } from "@/integrations/supabase/client";

const CARD_IMAGE_BUCKET = "card-images";
const STORAGE_MARKER = `/storage/v1/object/`;

/**
 * Returns the permanent public URL for a file in the card-images bucket.
 * Since the bucket is public, no signed token is needed — URLs never expire.
 */
export function getPublicImageUrl(filePath: string): string {
  const normalizedPath = normalizeStoragePath(filePath);
  if (!normalizedPath) return "";

  const { data } = supabase.storage.from(CARD_IMAGE_BUCKET).getPublicUrl(normalizedPath);
  return data.publicUrl;
}

/**
 * Converts any stored image reference into the best browser-safe card image URL.
 * Handles:
 * - already-public URLs
 * - expired Supabase signed URLs
 * - raw bucket paths like cards/abc.jpg
 * - bucket-prefixed paths like card-images/cards/abc.jpg
 * - full Supabase storage paths with encoded characters
 * - external http(s), blob:, and data: URLs
 */
export function toPublicImageUrl(url: string | null | undefined): string {
  if (!url) return "";

  const value = String(url).trim();
  if (!value) return "";

  if (isInlineOrRuntimeUrl(value)) return value;
  if (isPlaceholderUrl(value)) return value;

  const storagePath = extractCardImageStoragePath(value);
  if (storagePath) return getPublicImageUrl(storagePath);

  // Raw storage paths from card-images bucket often get stored without a protocol.
  if (looksLikeStoragePath(value)) return getPublicImageUrl(value);

  return value;
}

export function isPlaceholderUrl(url: string | null | undefined): boolean {
  const value = String(url || "").toLowerCase();
  return !value || value.includes("placehold") || value.includes("placeholder") || value === "null" || value === "undefined";
}

function isInlineOrRuntimeUrl(value: string): boolean {
  return /^(data:|blob:|filesystem:)/i.test(value);
}

function looksLikeStoragePath(value: string): boolean {
  if (/^https?:\/\//i.test(value)) return false;
  if (value.startsWith("/")) return false;
  if (value.includes(" ")) return false;
  return /\.(avif|webp|png|jpe?g|gif|bmp|svg)(\?.*)?$/i.test(value) || value.startsWith(`${CARD_IMAGE_BUCKET}/`);
}

function normalizeStoragePath(path: string): string {
  let value = String(path || "").trim();
  if (!value) return "";

  value = stripQueryAndHash(value);
  value = value.replace(/^\/+/, "");

  if (value.startsWith(`${CARD_IMAGE_BUCKET}/`)) {
    value = value.slice(CARD_IMAGE_BUCKET.length + 1);
  }

  return safeDecode(value);
}

function extractCardImageStoragePath(value: string): string | null {
  const directMatch = value.match(/\/object\/(?:public|sign)\/card-images\/(.+?)(?:[?#]|$)/i);
  if (directMatch?.[1]) return safeDecode(directMatch[1]);

  const encodedBucketMatch = value.match(/\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:[?#]|$)/i);
  if (encodedBucketMatch?.[1] && safeDecode(encodedBucketMatch[1]) === CARD_IMAGE_BUCKET) {
    return safeDecode(encodedBucketMatch[2]);
  }

  const markerIndex = value.indexOf(STORAGE_MARKER);
  if (markerIndex >= 0) {
    const afterMarker = value.slice(markerIndex + STORAGE_MARKER.length);
    const parts = stripQueryAndHash(afterMarker).split("/");
    const mode = parts.shift();
    const bucket = parts.shift();
    if ((mode === "public" || mode === "sign") && safeDecode(bucket || "") === CARD_IMAGE_BUCKET) {
      return safeDecode(parts.join("/"));
    }
  }

  return null;
}

function stripQueryAndHash(value: string): string {
  return value.split("?")[0].split("#")[0];
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
