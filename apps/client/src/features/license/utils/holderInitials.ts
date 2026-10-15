/**
 * Initials shown on the licence card when no photo is stored (#246): first
 * letter of the first name and of the last name, or of the first two words of
 * a club name (a CLUB card has only a last name). Empty when no letter is
 * available — the card then falls back to a neutral silhouette.
 */
export const holderInitials = (firstName: string, lastName: string): string => {
  const first = firstName.trim();
  const last = lastName.trim();
  const sources =
    first && last
      ? [first, last]
      : `${first} ${last}`.split(/[\s-]+/).filter(Boolean);
  return sources
    .slice(0, 2)
    .map((word) => /[\p{L}\p{N}]/u.exec(word)?.[0] ?? "")
    .join("")
    .toLocaleUpperCase("fr-FR");
};
