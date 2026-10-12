import { Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  registrationEventBibSelect,
  registrationEventHolderSelect,
  registrationPartnerNameSelect,
  resultAnonymizationSelect,
  userNameSelect,
} from "../utils/prisma-selects";
import {
  isUsableBib,
  personNameMatches,
  readParticipantLabel,
  scrubParticipantLabel,
} from "./partner-name-scrub.utils";

/**
 * Bound of each read below: a licensee takes part in a few dozen events a
 * season. Hitting it is logged (rows beyond keep the name).
 */
export const MAX_PARTNER_SCRUB_ROWS = 1000;

/**
 * Droit à l'effacement (#395) : copies du NOM de la personne supprimée chez
 * un tiers, sans identifiant qui les relie à elle.
 *
 * 1. Inscription du partenaire créée par l'import historique
 *    (`partnerName` sans `partnerUserId`) : retrouvée par le couple — même
 *    épreuve, même dossard qu'une inscription de la personne — puis confirmée
 *    par le nom ; `partnerName` → null. Les inscriptions liées par
 *    `partnerUserId` sont traitées par AccountDeletionService.
 * 2. Résultat de couple rattaché au partenaire (l'import crée une ligne par
 *    couple, au nom du premier membre reconnu) : retrouvé par épreuve +
 *    dossard, ou par l'inscription du partenaire qui la nomme ; seule la
 *    moitié du libellé `details.participant` qui la nomme est remplacée par
 *    « Partenaire supprimé ». La ligne et son classement restent (ils
 *    appartiennent aussi au partenaire). Un libellé où aucune moitié ne la
 *    nomme n'est pas touché (pas de devinette).
 *
 * Lectures AVANT la transaction (ses propres inscriptions y sont supprimées) ;
 * renvoie les écritures à ajouter à la transaction de suppression, et les
 * compétitions dont un résultat est réécrit (cache Redis des résultats à
 * invalider après la transaction).
 */
export interface PartnerNameScrub {
  ops: Prisma.PrismaPromise<unknown>[];
  competitionIds: string[];
}

export async function buildPartnerNameScrubOps(
  prisma: PrismaService,
  userId: string,
  logger: Logger,
): Promise<PartnerNameScrub> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: userNameSelect,
  });
  if (!user) return { ops: [], competitionIds: [] };

  const [own, asPartner] = await Promise.all([
    prisma.registration.findMany({
      where: { userId },
      select: registrationEventBibSelect,
      take: MAX_PARTNER_SCRUB_ROWS,
    }),
    prisma.registration.findMany({
      where: { partnerUserId: userId },
      select: registrationEventHolderSelect,
      take: MAX_PARTNER_SCRUB_ROWS,
    }),
  ]);
  const couples = own.flatMap((r) =>
    isUsableBib(r.bibNumber) ? [{ eventId: r.eventId, bib: r.bibNumber }] : [],
  );

  const legacyPartnerRegistrations =
    couples.length === 0
      ? []
      : await prisma.registration.findMany({
          where: {
            userId: { not: userId },
            partnerUserId: null,
            partnerName: { not: null },
            OR: couples.map((c) => ({ eventId: c.eventId, bibNumber: c.bib })),
          },
          select: registrationPartnerNameSelect,
          take: MAX_PARTNER_SCRUB_ROWS,
        });
  const legacyIds = legacyPartnerRegistrations
    .filter((r) =>
      personNameMatches(r.partnerName, user.firstName, user.lastName),
    )
    .map((r) => r.id);

  const resultFilters: Prisma.ResultWhereInput[] = [
    ...couples.flatMap((c) => [
      // The import stores the bib as scraped (a string); seeds as a number.
      { eventId: c.eventId, details: { path: ["bib"], equals: String(c.bib) } },
      { eventId: c.eventId, details: { path: ["bib"], equals: c.bib } },
    ]),
    ...asPartner.map((r) => ({ eventId: r.eventId, userId: r.userId })),
  ];
  const coupleResults =
    resultFilters.length === 0
      ? []
      : await prisma.result.findMany({
          where: { userId: { not: userId }, OR: resultFilters },
          select: resultAnonymizationSelect,
          take: MAX_PARTNER_SCRUB_ROWS,
        });

  if (
    [own, asPartner, legacyPartnerRegistrations, coupleResults].some(
      (rows) => rows.length === MAX_PARTNER_SCRUB_ROWS,
    )
  ) {
    // No user identifier in the log.
    logger.warn(
      `Account deletion: a partner-name read hit the ${MAX_PARTNER_SCRUB_ROWS} cap — some partner rows may keep the name`,
    );
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  const competitionIds = new Set<string>();
  if (legacyIds.length > 0) {
    ops.push(
      prisma.registration.updateMany({
        where: { id: { in: legacyIds }, partnerUserId: null },
        data: { partnerName: null },
      }),
    );
  }
  for (const result of coupleResults) {
    const label = readParticipantLabel(result.details);
    const scrubbed =
      label && scrubParticipantLabel(label, user.firstName, user.lastName);
    if (!scrubbed) continue;
    competitionIds.add(result.event.competitionId);
    ops.push(
      prisma.result.update({
        where: { id: result.id },
        data: {
          details: {
            ...(result.details as Prisma.JsonObject),
            participant: scrubbed,
          },
        },
      }),
    );
  }
  return { ops, competitionIds: [...competitionIds] };
}
