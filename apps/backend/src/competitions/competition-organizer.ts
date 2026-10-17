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
 * Organiser rights are decided on club ids only (#625): a LINKED
 * competition by its link (a label never overrides it); an UNLINKED one by
 * the ONE club its label designates (homonyms → nobody). The account side is
 * always a club id too: a legacy account without `clubId` counts only once
 * resolved to the one active club its name designates (`organizerActorOf`).
 *
 * FOLLOW-UP (#408, #625): once the backfill reports no unlinked competition
 * on every environment, drop the remaining label resolution (the
 * `organizerClubId: null` branches below, `resolveOrganizerClubId` /
 * `organizerMatcher`, and `findClubIdByName` callers outside the sync /
 * creation).
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

/** Outcome of resolving a legacy club account (no `clubId`) by its name. */
export type LegacyClubResolution = ClubNameMatch | { kind: "disabled" };

/**
 * The ONE ACTIVE club a legacy club account's name designates (case and
 * surrounding spaces ignored, #625 / #743). Never guessed: no club, several
 * clubs (homonyms) or a disabled club are reported as such, and the caller
 * refuses or grants nothing. Never creates a club.
 */
export async function resolveActiveClubByName(
  db: ClubReader,
  name: string | null | undefined,
): Promise<LegacyClubResolution> {
  const match = await matchClubByName(db, name);
  if (match.kind !== "match") return match;
  const active = await db.club.findFirst({
    where: { id: match.clubId, disabledAt: null },
    select: idOnlySelect,
  });
  return active ? { kind: "match", clubId: active.id } : { kind: "disabled" };
}

/**
 * The organiser-check actor of a user (#625). A linked account is its club:
 * its id, and the club's CURRENT name for the unlinked rows — never
 * `User.clubName`, a copy that may be stale. A legacy account without
 * `clubId` is resolved to the ONE ACTIVE club its name designates
 * (`resolveActiveClubByName`); a name designating no club, several clubs
 * (homonyms) or a disabled club leaves it without id — and an actor without
 * a club id organises nothing.
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
  const resolved = await resolveActiveClubByName(db, user.clubName);
  return {
    clubId: resolved.kind === "match" ? resolved.clubId : null,
    clubNames: [user.clubName],
  };
}

/** The club whose members a club account lists, and the matching filter. */
export interface ClubMembersScope {
  clubId: string;
  /** `User` filter selecting the members of `clubId`. */
  members: Prisma.UserWhereInput;
}

/**
 * The members a club account sees in its lists (#749). A linked account
 * lists the users linked to its club. A legacy account without `clubId` is
 * first resolved to the ONE ACTIVE club its name designates
 * (`organizerActorOf`); it then lists that club's linked users plus the
 * legacy users named after it — safe because the name designates this club
 * alone. An account that resolves to no club (no name, unknown name,
 * homonyms, disabled club) lists nobody: `null`. Never `User.clubName`
 * compared on its own — a homonym club's members would appear.
 */
export async function clubMembersScopeOf(
  db: ClubReader,
  account: { clubId: string | null; clubName: string | null },
): Promise<ClubMembersScope | null> {
  if (account.clubId) {
    return { clubId: account.clubId, members: { clubId: account.clubId } };
  }
  const name = account.clubName?.trim();
  if (!name) return null;
  const { clubId } = await organizerActorOf(db, {
    clubId: null,
    clubName: name,
  });
  if (!clubId) return null;
  return {
    clubId,
    members: {
      OR: [{ clubId }, { clubId: null, clubName: sameClubName(name) }],
    },
  };
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
 * organise — a superset (unlinked rows by name): filter the result with
 * `organizerMatcher`. `null` when the actor has no club id: it organises
 * nothing (#625).
 */
export function organizedByClubWhere(
  actor: OrganizerClubActor,
): Prisma.CompetitionWhereInput | null {
  if (!actor.clubId) return null;
  const names = distinctNames(actor.clubNames).map((name) => ({
    organizer: sameClubName(name),
  }));
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
 * `isOrganizedByMyClub` flag and the edit rights always agree (#408, #625):
 * - linked competition: ids only — a label never overrides the link;
 * - unlinked competition: the label must designate exactly the actor's club
 *   (an ambiguous homonym label grants nobody);
 * - actor without club id (see `organizerActorOf`): nothing.
 */
export async function organizerMatcher(
  db: ClubReader,
  competitions: readonly CompetitionOrganizerRef[],
  actor: OrganizerClubActor,
): Promise<(competition: CompetitionOrganizerRef) => boolean> {
  const clubId = actor.clubId;
  if (!clubId) return () => false;
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

/**
 * Users addressed as `club`'s managers by a notification (#625): accounts
 * linked to it, plus legacy accounts without `clubId` named after it — only
 * while that name designates this club alone. With a homonym club (same name
 * up to case), legacy accounts are never addressed: they could belong to
 * either.
 */
export async function clubManagersOfClubWhere(
  db: ClubReader,
  club: { id: string; name: string },
): Promise<Prisma.UserWhereInput> {
  const uniqueName = (await findClubIdByName(db, club.name)) === club.id;
  if (!uniqueName) return { clubId: club.id };
  return {
    OR: [
      { clubId: club.id },
      { clubId: null, clubName: sameClubName(club.name.trim()) },
    ],
  };
}
