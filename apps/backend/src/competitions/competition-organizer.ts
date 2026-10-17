import { Prisma } from "@prisma/client";
import { sameClubName } from "../utils/club-name-filter";
import { clubIdNameSelect, idOnlySelect } from "../utils/prisma-selects";

const normalize = (name: string | null | undefined): string =>
  name?.trim().toLowerCase() ?? "";

/**
 * The organising club of a competition (#408): `organizerClubId` is the key
 * of every "which club organises it" resolution (payment credentials, payment
 * notifications, organiser rights). `organizer` is the display label (FFD
 * company name), used as a fallback only while a row is not linked yet.
 *
 * A LINKED competition is matched on ids only (#625), whatever the account:
 * a legacy account without `clubId` is first resolved to the ONE club its
 * name designates (`organizerActorOf`), and gets nothing on a linked row if
 * that name designates no club or several.
 *
 * FOLLOW-UP (#408, #625): once the backfill reports no unlinked competition
 * on every environment, drop the remaining name fallback (the
 * `organizerClubId: null` branches below, the label resolution of
 * `resolveOrganizerClubId` / `organizerMatcher`, and `findClubIdByName`
 * callers outside the sync / creation).
 */
export interface CompetitionOrganizerRef {
  organizerClubId?: string | null;
  organizer?: string | null;
}

/** A club account (or user) as seen by the organiser checks. */
export interface OrganizerClubActor {
  /** The account's club, when linked (`User.clubId`). */
  clubId?: string | null;
  /** Names the account is known by (legacy accounts without `clubId`). */
  clubNames: readonly (string | null | undefined)[];
}

/** Outcome of matching a free-text organiser name against `Club.name`. */
export type ClubNameMatch =
  | { kind: "match"; clubId: string }
  | { kind: "none" }
  | { kind: "ambiguous" };

type ClubReader = Pick<Prisma.TransactionClient, "club">;

/**
 * Matches an organiser name on `Club.name`: trimmed, case ignored. Two clubs
 * whose names only differ by case make the name ambiguous — never guessed.
 */
export async function matchClubByName(
  db: ClubReader,
  name: string | null | undefined,
): Promise<ClubNameMatch> {
  const trimmed = name?.trim();
  if (!trimmed) return { kind: "none" };
  const clubs = await db.club.findMany({
    where: { name: sameClubName(trimmed) },
    select: idOnlySelect,
    orderBy: { id: "asc" },
    take: 2,
  });
  if (clubs.length === 0) return { kind: "none" };
  if (clubs.length > 1) return { kind: "ambiguous" };
  return { kind: "match", clubId: clubs[0].id };
}

/** The id of the ONE club named `name`, or null (none, or ambiguous). */
export async function findClubIdByName(
  db: ClubReader,
  name: string | null | undefined,
): Promise<string | null> {
  const match = await matchClubByName(db, name);
  return match.kind === "match" ? match.clubId : null;
}

/**
 * The organising club's id: the stored link, else (unlinked row) the club the
 * label unambiguously names.
 */
export async function resolveOrganizerClubId(
  db: ClubReader,
  competition: CompetitionOrganizerRef,
): Promise<string | null> {
  if (competition.organizerClubId) return competition.organizerClubId;
  return findClubIdByName(db, competition.organizer);
}

/**
 * The organiser-check actor of a user (#625). A linked account is its club:
 * its id, and the club's CURRENT name for the unlinked rows — never
 * `User.clubName`, a copy that may be stale. A legacy account without
 * `clubId` is resolved to the ONE club its name designates (case and
 * surrounding spaces ignored); a name designating none or several clubs
 * leaves it without id, so it never matches a linked competition.
 */
export async function organizerActorOf(
  db: ClubReader,
  user: {
    clubId: string | null;
    clubName: string | null;
    club?: { name: string } | null;
  },
): Promise<OrganizerClubActor> {
  if (user.clubId) {
    return { clubId: user.clubId, clubNames: [user.club?.name] };
  }
  return {
    clubId: await findClubIdByName(db, user.clubName),
    clubNames: [user.clubName],
  };
}

/**
 * Whether `actor`'s club organises `competition`.
 * - Linked competition: ids only (homonyms never confused, a club rename
 *   changes nothing); an actor without a club id never matches it (#625).
 * - Unlinked competition, actor without club id (legacy fallback, #408):
 *   the label equals one of the account's club names, case and surrounding
 *   spaces ignored; an empty organiser never matches.
 */
export function isOrganizedByClub(
  competition: CompetitionOrganizerRef,
  actor: OrganizerClubActor,
): boolean {
  if (competition.organizerClubId) {
    return !!actor.clubId && competition.organizerClubId === actor.clubId;
  }
  const org = normalize(competition.organizer);
  return org !== "" && actor.clubNames.some((name) => normalize(name) === org);
}

function distinctNames(
  names: readonly (string | null | undefined)[],
): string[] {
  return [
    ...new Set(
      names
        .map((name) => name?.trim())
        .filter((name): name is string => !!name),
    ),
  ];
}

/**
 * Prisma filter selecting the CANDIDATE competitions `actor`'s club may
 * organise — a superset for a linked account (unlinked rows by name): filter
 * the result with `organizerMatcher`. `null` when the actor has neither a
 * club id nor a club name (it organises nothing). Without a club id, only
 * unlinked rows can be its (#625).
 */
export function organizedByClubWhere(
  actor: OrganizerClubActor,
): Prisma.CompetitionWhereInput | null {
  const names = distinctNames(actor.clubNames).map((name) => ({
    organizer: sameClubName(name),
  }));
  if (!actor.clubId) {
    return names.length > 0 ? { organizerClubId: null, OR: names } : null;
  }
  return {
    OR: [
      { organizerClubId: actor.clubId },
      ...names.map((byName) => ({ organizerClubId: null, ...byName })),
    ],
  };
}

/** Upper bound of the clubs read to resolve a page of unlinked labels. */
export const MAX_LABEL_CLUBS_PER_PAGE = 200;

/**
 * The club each label designates, keyed by normalised label: its id when
 * exactly ONE club carries that name (case ignored), null when none or
 * several (homonyms). One bounded read for all labels; a truncated read can
 * only drop matches, never invent one (a label left without its club
 * resolves to null — never granted).
 */
export async function resolveClubIdsByLabels(
  db: ClubReader,
  labels: readonly (string | null | undefined)[],
): Promise<Map<string, string | null>> {
  const distinct = distinctNames(labels);
  const resolved = new Map<string, string | null>();
  if (distinct.length === 0) return resolved;
  const clubs = await db.club.findMany({
    where: {
      OR: distinct.map((label) => ({
        name: sameClubName(label),
      })),
    },
    select: clubIdNameSelect,
    orderBy: { id: "asc" },
    take: MAX_LABEL_CLUBS_PER_PAGE,
  });
  const byKey = new Map<string, string[]>();
  for (const club of clubs) {
    const key = normalize(club.name);
    byKey.set(key, [...(byKey.get(key) ?? []), club.id]);
  }
  for (const label of distinct) {
    const ids = byKey.get(normalize(label)) ?? [];
    resolved.set(normalize(label), ids.length === 1 ? ids[0] : null);
  }
  return resolved;
}

/**
 * "Organised by `actor`'s club" for a page of competitions — the same rule
 * as the access check (CompetitionAccessService), so the club list, the
 * `isOrganizedByMyClub` flag and the edit rights always agree (#408):
 * - linked competition, linked account: ids only;
 * - unlinked competition, linked account: the label must designate exactly
 *   the account's club (an ambiguous homonym label grants nobody);
 * - actor without club id (legacy account whose name designates no single
 *   club, see `organizerActorOf`): nothing linked; on an unlinked row, the
 *   label equals one of its names.
 */
export async function organizerMatcher(
  db: ClubReader,
  competitions: readonly CompetitionOrganizerRef[],
  actor: OrganizerClubActor,
): Promise<(competition: CompetitionOrganizerRef) => boolean> {
  const clubId = actor.clubId;
  if (!clubId) return (competition) => isOrganizedByClub(competition, actor);
  const resolved = await resolveClubIdsByLabels(
    db,
    competitions
      .filter((competition) => !competition.organizerClubId)
      .map((competition) => competition.organizer),
  );
  return (competition) =>
    competition.organizerClubId
      ? competition.organizerClubId === clubId
      : resolved.get(normalize(competition.organizer)) === clubId;
}
