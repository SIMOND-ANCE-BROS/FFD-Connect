/**
 * Small, stable, synchronous string hash (FNV-1a, 32-bit) for deterministic
 * cache filenames. NOT a cryptographic hash — only used to derive file names
 * that must be identical across app launches and collision-resistant enough
 * for a few hundred cache entries.
 *
 * Works on UTF-16 code units, so accented characters (French announcements)
 * contribute to the hash instead of being flattened to "_".
 */
export function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiplication, kept in uint32 range.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Cache key for a string: hash + length. Including the length makes the
 * already-unlikely 32-bit collision even less likely for texts of different
 * sizes.
 */
export function stableCacheKey(input: string): string {
  return `${fnv1aHash(input)}_${input.length.toString(36)}`;
}
