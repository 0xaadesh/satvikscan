/**
 * Normalize an ingredient list for consistent caching.
 * Steps: lowercase → trim → remove empties → deduplicate → sort alphabetically
 * Returns the sorted array, a concatenated text form, and an MD5 hash for exact lookup.
 */
export function normalizeIngredients(raw: string[]): {
  array: string[];
  text: string;
  hash: string;
} {
  const seen = new Set<string>();

  for (const item of raw) {
    const cleaned = item.toLowerCase().trim();
    if (cleaned.length > 0) {
      seen.add(cleaned);
    }
  }

  const array = [...seen].sort();
  const text = array.join(" || ");

  const hasher = new Bun.CryptoHasher("md5");
  hasher.update(text);
  const hash = hasher.digest("hex");

  return { array, text, hash };
}
