import { Prisma } from "@prisma/client";
import { idOnlySelect } from "../utils/prisma-selects";

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
 * Prisma filter matching the competitions `actor`'s club organises — the
 * query form of `isOrganizedByClub`. `null` when the actor has neither a club
 * id nor a club name (it organises nothing).
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
