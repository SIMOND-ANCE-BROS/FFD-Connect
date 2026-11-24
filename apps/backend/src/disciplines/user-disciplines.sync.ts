/**
 * Dual write of a dancer's disciplines (ADR-0026 §5, step 2 — #1023).
 *
 * During this step the legacy columns stay the source of truth and the only
 * thing read: `User.category`, `passportLevelLatin` / `passportLevelStandard`
 * and `competitionLevelLatin` / `competitionLevelStandard`. Every write of
 * one of them calls {@link syncUserDisciplines} in the same transaction,
 * which recomputes the dancer's `UserDiscipline` rows of the sport dance
 * domain from the stored columns. Reads switch in #1024; the dual write stops
 * in #1029.
 *
 * {@link deriveUserDisciplines} holds the mapping rules. The backfill of
 * migration `20261124130000_user_discipline` applies the very same rules in
 * SQL; `test/user-discipline-backfill.integration-spec.ts` checks that both
 * agree.
 */
import type { PassportLevel, Prisma } from "@prisma/client";
import { normalizeDiscipline } from "../common/competition-level";
import {
  disciplineCodeSelect,
  idOnlySelect,
  userDisciplineSourceSelect,
} from "../utils/prisma-selects";

/** Discipline codes of the sport dance domain (LATINES_STANDARDS). */
export const SPORT_DANCE_DISCIPLINE_CODES = [
  "LATIN",
  "STANDARD",
  "TEN_DANCE",
] as const;
export type SportDanceDisciplineCode =
  (typeof SPORT_DANCE_DISCIPLINE_CODES)[number];

/** User columns mirrored into `UserDiscipline`. */
export const LEGACY_DISCIPLINE_FIELDS = Object.keys(
  userDisciplineSourceSelect,
) as (keyof typeof userDisciplineSourceSelect)[];

/** The legacy discipline columns of a user. */
export interface LegacyDisciplineProfile {
  category?: string | null;
  passportLevelLatin?: PassportLevel | null;
  passportLevelStandard?: PassportLevel | null;
  competitionLevelLatin?: string | null;
  competitionLevelStandard?: string | null;
}

/** A `UserDiscipline` row, by discipline code. */
export interface DerivedUserDiscipline {
  code: SportDanceDisciplineCode;
  passportLevel: PassportLevel | null;
  competitionLevel: string | null;
  primary: boolean;
}

/** Trimmed value, null when blank (the backfill applies the same rule). */
function nonBlank(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v === undefined || v === "" ? null : v;
}

/**
 * The `UserDiscipline` rows the legacy columns stand for:
 * - the declared discipline (`category`, any spelling known to
 *   `normalizeDiscipline`): Latin → LATIN, Standard → STANDARD, Ten Dance →
 *   LATIN + STANDARD + TEN_DANCE; the declared one is primary;
 * - a Passeport or competition level in Latin / Standard also adds that
 *   discipline (not primary), so no level is lost when reads switch;
 * - levels are copied to their discipline; TEN_DANCE carries none (10-dance
 *   events have no level requirement).
 * An unknown `category` (free text, beta placeholder) declares nothing.
 */
export function deriveUserDisciplines(
  profile: LegacyDisciplineProfile,
): DerivedUserDiscipline[] {
  const declared = normalizeDiscipline(profile.category);
  const tenDance = declared === "Ten Dance";
  const rows: DerivedUserDiscipline[] = [];

  const latinLevel = nonBlank(profile.competitionLevelLatin);
  const latinPassport = profile.passportLevelLatin ?? null;
  if (declared === "Latin" || tenDance || latinLevel || latinPassport) {
    rows.push({
      code: "LATIN",
      passportLevel: latinPassport,
      competitionLevel: latinLevel,
      primary: declared === "Latin",
    });
  }

  const standardLevel = nonBlank(profile.competitionLevelStandard);
  const standardPassport = profile.passportLevelStandard ?? null;
  if (
    declared === "Standard" ||
    tenDance ||
    standardLevel ||
    standardPassport
  ) {
    rows.push({
      code: "STANDARD",
      passportLevel: standardPassport,
      competitionLevel: standardLevel,
      primary: declared === "Standard",
    });
  }

  if (tenDance) {
    rows.push({
      code: "TEN_DANCE",
      passportLevel: null,
      competitionLevel: null,
      primary: true,
    });
  }
  return rows;
}

/** True when a write payload sets at least one mirrored column. */
export function touchesDisciplineFields(
  data: Record<string, unknown> | null | undefined,
): boolean {
  return !!data && LEGACY_DISCIPLINE_FIELDS.some((f) => data[f] !== undefined);
}

/**
 * Recomputes the dancer's `UserDiscipline` rows of the sport dance domain
 * from the stored legacy columns. Call it inside the transaction that wrote
 * them, AFTER the write. Rows of other domains are never touched. A code
 * missing from the catalog is skipped (the migration inserts all three).
 */
export async function syncUserDisciplines(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: userDisciplineSourceSelect,
  });
  if (!user) return;

  const catalog = await tx.discipline.findMany({
    where: { code: { in: [...SPORT_DANCE_DISCIPLINE_CODES] } },
    select: disciplineCodeSelect,
    take: SPORT_DANCE_DISCIPLINE_CODES.length,
  });
  const idByCode = new Map(catalog.map((d) => [d.code, d.id]));

  const wanted = deriveUserDisciplines(user).flatMap((row) => {
    const disciplineId = idByCode.get(row.code);
    return disciplineId ? [{ ...row, disciplineId }] : [];
  });

  await tx.userDiscipline.deleteMany({
    where: {
      userId,
      disciplineId: {
        in: catalog.map((d) => d.id),
        notIn: wanted.map((w) => w.disciplineId),
      },
    },
  });
  for (const {
    disciplineId,
    passportLevel,
    competitionLevel,
    primary,
  } of wanted) {
    const levels = { passportLevel, competitionLevel, primary };
    await tx.userDiscipline.upsert({
      where: { userId_disciplineId: { userId, disciplineId } },
      create: { userId, disciplineId, ...levels },
      update: levels,
      select: idOnlySelect,
    });
  }
}
