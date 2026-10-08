const normalize = (name: string | null | undefined): string =>
  name?.trim().toLowerCase() ?? "";

/**
 * `Competition.organizer` holds the organizing club's name (FFD sync), the
 * same value as `Club.name` / `User.clubName`. Case and surrounding spaces are
 * ignored; an empty organizer never matches.
 */
export function isOrganizedByClub(
  organizer: string | null | undefined,
  clubNames: readonly (string | null | undefined)[],
): boolean {
  const org = normalize(organizer);
  return org !== "" && clubNames.some((name) => normalize(name) === org);
}
