/** Remove accents for stable matching (è→e, é→e, etc.) */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** Parse "First LAST" or "First LAST1 LAST2" → { firstName, lastName } */
export function parseFullName(fullName: string): {
  firstName: string;
  lastName: string;
} {
  const raw = fullName.trim().replace(/\s+/g, " ");
  const parts = raw.split(" ");
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  // Heuristic: last name often ALL CAPS or last token(s)
  const allCaps = parts.filter((p) => p === p.toUpperCase() && p.length > 1);
  const lastName =
    allCaps.length > 0 ? allCaps.join(" ") : parts.slice(-1).join(" ");
  const firstName =
    allCaps.length > 0
      ? parts.filter((p) => p !== p.toUpperCase()).join(" ") || parts[0]
      : parts.slice(0, -1).join(" ") || parts[0];
  return { firstName: firstName.trim(), lastName: lastName.trim() };
}

/** Parse ranking string "1", "8- 9", "10- 12" → number */
export function parseRank(rankStr: string): number {
  const first = rankStr.replace(/[^\d]/g, "");
  return first ? parseInt(first, 10) : 999;
}

/** Split inter-club string "Club A - Club B" into [Club A, Club B] (trimmed). Single club returns [club]. */
export function parseClubNames(clubStr: string): {
  clubs: string[];
  isInterClub: boolean;
} {
  const raw = (clubStr || "").trim();
  if (!raw) return { clubs: [], isInterClub: false };
  if (raw.includes(" - ")) {
    const parts = raw
      .split(" - ")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 2)
      return { clubs: [parts[0], parts[1]], isInterClub: true };
  }
  return { clubs: [raw], isInterClub: false };
}
