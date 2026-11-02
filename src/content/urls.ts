export function decodeLocalImageUrl(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  } // A literal percent sign is valid in a local filename.
}
