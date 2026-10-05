/**
 * Déduplication « métier » : deux titres sont considérés identiques quand
 * (artiste + titre) normalisés coïncident, même si leurs sources diffèrent
 * (le même morceau via un lien Spotify ET un lien YouTube produit deux
 * `sourceKey` différents que la dédup par clé ne rapproche pas).
 */

/** Minuscules, sans accents, sans parenthèses/feat., alphanumérique épuré. */
function normalizePart(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents (diacritiques combinants)
    .replace(/['\u2019]/g, '') // apostrophes : "Don't" \u2261 "Dont"
    .replace(/\(.*?\)|\[.*?\]/g, ' ') // "(Official Video)", "[Remastered]"…
    .replace(/\b(?:feat|ft|featuring)\b.*$/g, ' ') // invités : non discriminants
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Signature métier d'un titre. L'artiste inconnu ("Unknown"/vide) est
 * remplacé par "?" pour ne pas rapprocher deux morceaux homonymes d'artistes
 * différents non identifiés.
 */
export function trackSignature(artist: string, title: string): string {
  const a = normalizePart(artist);
  const t = normalizePart(title);
  const artistPart = a === '' || a === 'unknown' ? '?' : a;
  return `${artistPart}|${t}`;
}
