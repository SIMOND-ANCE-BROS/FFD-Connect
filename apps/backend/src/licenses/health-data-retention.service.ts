import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { LicenseRenewalDocumentType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RenewalDocumentFileCleaner } from "../storage/renewal-document-file-cleaner.service";
import { getErrorMessage } from "../utils/error.utils";
import {
  isMedicalCertificateDue,
  purgeCandidateCutoff,
} from "./medical-certificate-retention.util";

/**
 * Nombre de documents examinés par passage.
 *
 * Borne la requête (CLAUDE.md : jamais de `findMany` non borné) et le nombre de
 * suppressions de blobs lancées en parallèle. Un reliquat n'est pas perdu : le
 * passage suivant le reprendra, en commençant par le plus ancien.
 */
const PURGE_BATCH_SIZE = 200;

export interface HealthDataPurgeReport {
  /** Documents assez vieux pour être candidats. */
  readonly scanned: number;
  /** Candidats effectivement arrivés à échéance. */
  readonly due: number;
  /** Lignes supprimées (fichier parti ET ligne effacée). */
  readonly purged: number;
  /** Échéances dont le fichier a résisté : retentées au passage suivant. */
  readonly retryLater: number;
}

/**
 * Applique la rétention annoncée sur les données de santé (issue #62).
 *
 * La politique de confidentialité publiée promet la suppression du certificat
 * médical « au plus tard 12 mois après la fin de validité ». Avant ce service,
 * **rien ne supprimait jamais** ni le blob ni les `ocrData` extraites : le texte
 * était en ligne, le code ne l'appliquait pas.
 *
 * ## Pourquoi un `@Cron` in-process ET un passage au démarrage
 *
 * Le backend tourne à `minReplicas=0`. Un `@Cron` in-process ne déclenche
 * aucune requête HTTP, donc ne réveille aucun conteneur et ne coûte rien — mais
 * il ne s'exécute que si une réplique est déjà vivante. Une planification à
 * heure fixe pourrait donc ne JAMAIS tomber pendant une fenêtre d'éveil.
 *
 * D'où les deux déclencheurs : toutes les heures tant que l'application tourne,
 * et une fois à chaque démarrage à froid — c'est le seul instant dont on est
 * certain. Même raisonnement et même cadence que `SessionCleanupService`.
 *
 * ## Périmètre
 *
 * Uniquement les `MEDICAL_CERTIFICATE`, seuls documents de santé au sens de
 * l'article 9. Le certificat de licence relève de la ligne « Compte & licence »
 * de la politique (3 ans après la dernière connexion), pas de celle-ci.
 */
@Injectable()
export class HealthDataRetentionService implements OnModuleInit {
  private readonly logger = new Logger(HealthDataRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileCleaner: RenewalDocumentFileCleaner,
  ) {}

  onModuleInit(): void {
    this.purgeExpiredHealthData().catch((error) => {
      this.logger.error(
        `Initial health data retention purge failed: ${getErrorMessage(error)}`,
      );
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredHealthData(): Promise<HealthDataPurgeReport> {
    const now = new Date();

    // Le SQL ne sait pas lire la date d'émission enfouie dans `ocrData` : il
    // ramène tout ce qui est assez vieux pour être dû DANS LE MEILLEUR DES CAS,
    // et l'échéance exacte est tranchée en mémoire. Le seuil est volontairement
    // large — il ne peut rater aucun document dû.
    const candidates = await this.prisma.licenseRenewalDocument.findMany({
      where: {
        type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
        createdAt: { lt: purgeCandidateCutoff(now) },
      },
      select: { id: true, filePath: true, createdAt: true, ocrData: true },
      orderBy: { createdAt: "asc" },
      take: PURGE_BATCH_SIZE,
    });

    const due = candidates.filter((document) =>
      isMedicalCertificateDue(document, now),
    );
    if (due.length === 0) {
      return {
        scanned: candidates.length,
        due: 0,
        purged: 0,
        retryLater: 0,
      };
    }

    // Le fichier d'abord, la ligne ensuite : la ligne est le seul pointeur vers
    // le blob. L'effacer alors que le blob a résisté laisserait une donnée de
    // santé orpheline que plus rien ne désigne.
    const removedFiles = await this.fileCleaner.deleteFiles(
      due.map((document) => document.filePath),
      "retention-purge",
    );
    const purgeable = due.filter((document) =>
      removedFiles.has(document.filePath),
    );

    if (purgeable.length > 0) {
      await this.prisma.licenseRenewalDocument.deleteMany({
        where: { id: { in: purgeable.map((document) => document.id) } },
      });
    }

    const report: HealthDataPurgeReport = {
      scanned: candidates.length,
      due: due.length,
      purged: purgeable.length,
      retryLater: due.length - purgeable.length,
    };

    // Aucune donnée personnelle dans le journal : des compteurs, rien d'autre.
    this.logger.log(
      `Health data retention: ${report.purged} medical certificate(s) purged, ` +
        `${report.retryLater} kept for retry (out of ${report.due} due, ${report.scanned} scanned)`,
    );
    return report;
  }
}
