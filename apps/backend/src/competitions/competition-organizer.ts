import { Prisma } from "@prisma/client";
import { clubIdNameSelect, idOnlySelect } from "../utils/prisma-selects";

const normalize = (name: string | null | undefined): string =>
  name?.trim().toLowerCase() ?? "";

/**
 * The organising club of a competition (#408): `organizerClubId` is the key
 * of every "which club organises it" resolution (payment credentials, payment
 * notifications, organiser rights). `organizer` is the display label (FFD
 * company name), used as a fallback only while a row is not linked yet.
 *
 * FOLLOW-UP (#408): once the backfill reports no unlinked competition on every
 * environment, drop the name fallback (the `organizerClubId: null` branches
 * below and `findClubIdByName` callers outside the sync / creation).
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
    where: { name: { equals: trimmed, mode: "insensitive" } },
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
 * Whether `actor`'s club organises `competition`.
 * - Linked competition + linked account: ids only (homonyms never confused,
 *   a club rename changes nothing).
 * - Otherwise (unlinked competition, or legacy account without `clubId`):
 *   the label equals one of the account's club names, case and surrounding
 *   spaces ignored; an empty organiser never matches.
 */
export function isOrganizedByClub(
  competition: CompetitionOrganizerRef,
  actor: OrganizerClubActor,
): boolean {
  if (competition.organizerClubId && actor.clubId) {
    return competition.organizerClubId === actor.clubId;
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
 * club id nor a club name (it organises nothing).
 */
export function organizedByClubWhere(
  actor: OrganizerClubActor,
): Prisma.CompetitionWhereInput | null {
  const names = distinctNames(actor.clubNames).map((name) => ({
    organizer: { equals: name, mode: Prisma.QueryMode.insensitive },
  }));
  if (!actor.clubId) {
    return names.length > 0 ? { OR: names } : null;
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
        name: { equals: label, mode: Prisma.QueryMode.insensitive },
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
 * - legacy account without `clubId`: label equals one of its names.
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
