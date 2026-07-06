// Local-first: images are stored as data URLs / OPFS handles directly on the
// card record, so there's no cloud bucket to translate. These helpers stay
// as identity functions for backwards compatibility with existing callers.

export function getPublicImageUrl(filePath: string): string {
  return filePath;
}

export function toPublicImageUrl(url: string): string {
  return url ?? "";
}
