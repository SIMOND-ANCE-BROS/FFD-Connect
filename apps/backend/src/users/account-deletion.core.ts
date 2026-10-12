/**
 * Shared core of a user account deletion (GDPR art. 17), usable outside Nest
 * dependency injection: AccountDeletionService (in-app + back-office
 * deletion) and scripts/purge-test-accounts.ts (staging boot) both build
 * their transaction from `buildAccountDeletionOperations`, so the list of
 * relations deleted / anonymised lives in ONE place (#412). A relation added
 * here is treated by both paths; never re-list these operations elsewhere.
 *
 * Only plain Prisma operations: no Redis, no storage, no logger. Side effects
 * outside the database (renewal document files, results cache) stay with the
 * caller.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { resultAnonymizationSelect } from "../utils/prisma-selects";

/**
 * Borne de la lecture des résultats à anonymiser (un résultat par épreuve
 * finale, quelques dizaines par saison). Au-delà, le filet `updateMany` de la
 * transaction anonymise quand même le reste (details vidé).
 */
export const MAX_RESULTS_TO_ANONYMIZE = 1000;

/**
 * Valeur sentinelle de `Result.userId` pour un résultat anonymisé (#382) :
 * l'UUID nul, jamais attribué à un compte (User.id = uuid v4 aléatoire), donc
 * jamais renvoyé par une requête « résultats de l'utilisateur X ».
 * La colonne reste NOT NULL exprès : le client Prisma d'une image antérieure
 * (rollback automatique du déploiement) lit `userId` comme `String` requis et
 * planterait sur un NULL. Reprise des comptes supprimés avant le correctif :
 * migration 20261012130000_result_anonymize_deleted_users.
 */
export const DELETED_USER_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Clés de `Result.details` (JSON libre d'import) conservées à l'anonymisation :
 * elles décrivent l'épreuve ou la prestation, pas la personne. Tout le reste
 * part — `participant` (nom du couple), `name`, `bib` (dossard), `club` et
 * toute clé inconnue : liste blanche plutôt que liste noire.
 */
export const ANONYMIZED_RESULT_DETAIL_KEYS = [
  "totalParticipants",
  "status",
  "marks",
] as const;

/**
 * Réduit `details` aux clés non identifiantes. Toujours un objet (jamais
 * null) : l'écran des résultats en direct lit `details.participant` sans
 * garde et retombe alors sur son libellé générique.
 */
export function anonymizeResultDetails(
  details: Prisma.JsonValue,
): Prisma.InputJsonObject {
  const kept: Record<string, Prisma.InputJsonValue> = {};
  if (details && typeof details === "object" && !Array.isArray(details)) {
    for (const key of ANONYMIZED_RESULT_DETAIL_KEYS) {
      const value = details[key];
      if (value !== undefined && value !== null) kept[key] = value;
    }
  }
  return kept;
}

/** Prisma delegates the deletion core touches (PrismaService or a script client). */
export type AccountDeletionPrisma = Pick<
  PrismaClient,
  | "result"
  | "notification"
  | "seatBooking"
  | "registration"
  | "trackCorrection"
  | "bugReport"
  | "adminAuditLog"
  | "user"
>;

/** A result row read before the transaction, to be anonymised. */
export type ResultToAnonymize = Prisma.ResultGetPayload<{
  select: typeof resultAnonymizationSelect;
}>;

/**
 * Reads (bounded) the user's results BEFORE the transaction: their details
 * are needed to keep the non-identifying keys, and their competitions to
 * invalidate the results cache afterwards.
 */
export function findResultsToAnonymize(
  prisma: Pick<PrismaClient, "result">,
  userId: string,
): Promise<ResultToAnonymize[]> {
  return prisma.result.findMany({
    where: { userId },
    select: resultAnonymizationSelect,
    take: MAX_RESULTS_TO_ANONYMIZE,
  });
}

/**
 * Operations of the deletion transaction, in order; the user row goes last
 * (callers may append their own operations after it).
 *
 * Results (Result.userId has no FK, #382) are ANONYMISED, not deleted: a row
 * is a couple's ranking in an event, deleting it would leave a hole in the
 * published ranking of the other couples. Per-row update guarded on
 * `{ id, userId }`: the ids were read before the transaction, so a row that
 * changed owner meanwhile (results re-import) is not rewritten, and a row
 * deleted meanwhile does not fail the whole deletion (`updateMany` affects 0
 * rows instead of throwing). The final `updateMany({ userId })` sweep catches
 * rows beyond the read cap or created meanwhile.
 */
export function buildAccountDeletionOperations(
  prisma: AccountDeletionPrisma,
  userId: string,
  results: readonly Pick<ResultToAnonymize, "id" | "details">[],
): Prisma.PrismaPromise<unknown>[] {
  return [
    ...results.map((r) =>
      prisma.result.updateMany({
        where: { id: r.id, userId },
        data: {
          userId: DELETED_USER_ID,
          details: anonymizeResultDetails(r.details),
        },
      }),
    ),
    prisma.result.updateMany({
      where: { userId },
      data: { userId: DELETED_USER_ID, details: {} },
    }),
    prisma.notification.deleteMany({ where: { userId } }),
    prisma.seatBooking.deleteMany({ where: { userId } }),
    prisma.registration.deleteMany({ where: { userId } }),
    // Inscriptions d'autrui où l'utilisateur est partenaire : la FK passerait
    // en SetNull, mais partnerName garde une copie de son nom complet.
    prisma.registration.updateMany({
      where: { partnerUserId: userId },
      data: { partnerUserId: null, partnerName: null },
    }),
    // Le SetNull de proposedById laisserait le commentaire libre, qui peut
    // identifier son auteur : il est effacé avant la suppression du compte.
    prisma.trackCorrection.updateMany({
      where: { proposedById: userId },
      data: { message: null },
    }),
    // BugReport.userId n'a pas de FK (report.prisma) : suppression explicite.
    prisma.bugReport.deleteMany({ where: { userId } }),
    // Keep the audit trail but strip what may identify the person (before /
    // after hold names, emails...). Must run before the caller's own ops so
    // an audit row appended after the user deletion keeps its { role }. Rows
    // the user authored as an admin stay (actorId -> SetNull).
    prisma.adminAuditLog.updateMany({
      where: { targetType: "USER", targetId: userId },
      data: { before: Prisma.DbNull, after: Prisma.DbNull },
    }),
    prisma.user.delete({ where: { id: userId } }),
  ];
}

/** Upper bound of one orphaned-results sweep (staging holds a few hundred results). */
export const MAX_ORPHANED_RESULTS = 1000;

interface OrphanedResultRow {
  id: string;
  userId: string;
  details: Prisma.JsonValue;
}

/**
 * Idempotent sweep of results whose `userId` points to no account and is not
 * the tombstone yet: left by a deletion path that did not anonymise them
 * (staging test-account purges before #412). Same treatment as a deletion.
 * The #396 data migration only ran once; this one can run at every boot.
 * Cost: an anti-join over the whole Result table (LIMIT bounds the rows
 * returned, not scanned) — fine at staging volume.
 *
 * Only UUID-shaped `userId` values are swept (User.id defaults to uuid()):
 * the staging demo seed (scripts/seed-checkin-test.ts) writes synthetic ids
 * such as `seed-live-couple-*` on purpose, and a future importer could store
 * a non-User identifier; neither must lose its names.
 *
 * STAGING / MAINTENANCE ONLY (called by scripts/purge-test-accounts.ts):
 * never call it from the app. It irreversibly strips names from rankings.
 * Returns the number of rows anonymised.
 */
export async function anonymizeOrphanedResults(
  prisma: Pick<PrismaClient, "result" | "$queryRaw" | "$transaction">,
): Promise<number> {
  const orphans = await prisma.$queryRaw<OrphanedResultRow[]>`
    SELECT r."id", r."userId", r."details"
    FROM "Result" r
    WHERE r."userId" <> ${DELETED_USER_ID}
      AND r."userId" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u."id" = r."userId")
    LIMIT ${MAX_ORPHANED_RESULTS}`;
  if (orphans.length === 0) return 0;
  const updated = await prisma.$transaction(
    orphans.map((r) =>
      // Guarded on the orphan userId: never rewrites a row re-attached meanwhile.
      prisma.result.updateMany({
        where: { id: r.id, userId: r.userId },
        data: {
          userId: DELETED_USER_ID,
          details: anonymizeResultDetails(r.details),
        },
      }),
    ),
  );
  return updated.reduce((sum, u) => sum + u.count, 0);
}
