import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { LicenseRenewalDocumentType, Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nestjs";
import { PrismaService } from "../prisma/prisma.service";
import { BlobStorageService } from "../storage/blob-storage.service";
import { RenewalDocumentFileCleaner } from "../storage/renewal-document-file-cleaner.service";
import { getErrorMessage } from "../utils/error.utils";
import { medicalCertificatePurgeDueAt } from "./medical-certificate-retention.util";

/**
 * Documents purgés par passage.
 *
 * Délibérément petit : chaque document déclenche une suppression de blob, et
 * toutes partent EN PARALLÈLE derrière le disjoncteur `azure-blob`, qui est
 * PARTAGÉ avec le streaming des musiques. Deux cents appels d'un coup sur un
 * stockage qui throttle ouvriraient le disjoncteur et couperaient la lecture
 * musicale des utilisateurs — une panne infligée par un travail de fond.
 */
const PURGE_BATCH_SIZE = 25;

/** Lignes antérieures datées par passage (voir {@link dateLegacyDocuments}). */
const BACKFILL_BATCH_SIZE = 200;

export interface HealthDataPurgeReport {
  /** Lignes antérieures qui ont reçu leur échéance pendant ce passage. */
  readonly dated: number;
  /** Documents arrivés à échéance et traités. */
  readonly due: number;
  /** Documents dont les données extraites ont été effacées. */
  readonly stripped: number;
  /** Lignes supprimées (fichier parti ET ligne effacée). */
  readonly purged: number;
  /** Échéances dont le fichier a résisté : retentées au passage suivant. */
  readonly retryLater: number;
  /** Passage abandonné faute de stockage utilisable. */
  readonly skipped: boolean;
}

const EMPTY_REPORT: HealthDataPurgeReport = {
  dated: 0,
  due: 0,
  stripped: 0,
  purged: 0,
  retryLater: 0,
  skipped: false,
};

/**
 * Applique la rétention annoncée sur les données de santé (issue #62).
 *
 * La politique de confidentialité publiée promet la suppression du certificat
 * médical « au plus tard 12 mois après la fin de validité ». Avant ce service,
 * **rien ne supprimait jamais** ni le fichier archivé ni les `ocrData` extraites
 * par OCR — qui contenaient `rawText`, 500 caractères bruts du certificat
 * (plus écrit ni renvoyé depuis #224).
 *
 * ## Pourquoi un `@Cron` in-process ET un passage au démarrage
 *
 * Le backend tourne à `minReplicas=0`. Un `@Cron` in-process ne déclenche
 * aucune requête HTTP, donc ne réveille aucun conteneur et ne coûte rien — mais
 * il ne s'exécute que si une réplique est déjà vivante. Une planification à
 * heure fixe pourrait donc ne JAMAIS tomber pendant une fenêtre d'éveil. D'où
 * les deux déclencheurs ; le démarrage à froid est le seul instant certain.
 *
 * ## L'effacement se fait en deux temps, et l'ordre est raisonné
 *
 * 1. `ocrData` est vidé pour TOUT document échu. C'est une écriture en base :
 *    elle n'échoue pas parce qu'un stockage externe va mal. Le texte de santé
 *    disparaît donc à l'heure dite, quoi qu'il arrive au fichier.
 * 2. Le fichier est supprimé, et la ligne seulement ensuite — elle est le seul
 *    pointeur vers le blob. L'effacer alors que le fichier a résisté
 *    abandonnerait un certificat que plus rien ne désigne.
 *
 * ## Périmètre
 *
 * Uniquement les `MEDICAL_CERTIFICATE`, seuls documents de santé au sens de
 * l'article 9. Le certificat de licence relève de la ligne « Compte & licence »
 * de la politique (3 ans), pas de celle-ci.
 */
@Injectable()
export class HealthDataRetentionService implements OnModuleInit {
  private readonly logger = new Logger(HealthDataRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileCleaner: RenewalDocumentFileCleaner,
    private readonly blobStorage: BlobStorageService,
  ) {}

  onModuleInit(): void {
    void this.runPass("boot");
  }

  @Cron(CronExpression.EVERY_HOUR)
  async handleCron(): Promise<void> {
    await this.runPass("cron");
  }

  /**
   * Enveloppe qui journalise le résultat ET l'échec.
   *
   * Sans elle, un rejet de `purgeExpiredHealthData` finissait dans le
   * `console.error` de la librairie cron : ni logger Nest, ni Sentry. Un
   * contrôle de conformité peut échouer toutes les heures — ça ne doit pas
   * passer inaperçu.
   */
  private async runPass(trigger: "boot" | "cron"): Promise<void> {
    try {
      const report = await this.purgeExpiredHealthData();
      // Journalisé À CHAQUE PASSAGE, y compris quand il n'y a rien à faire :
      // « zéro suppression » et « la purge ne tourne plus » doivent être
      // distinguables depuis les journaux.
      this.logger.log(
        `Health data retention (${trigger}): ${report.purged} purged, ` +
          `${report.stripped} stripped, ${report.retryLater} kept for retry, ` +
          `${report.dated} dated${report.skipped ? " — SKIPPED" : ""}`,
      );
      if (report.retryLater > 0) {
        this.logger.warn(
          `Health data retention: ${report.retryLater} document(s) past due whose file could not be deleted`,
        );
      }
    } catch (error) {
      const message = getErrorMessage(error);
      this.logger.error(`Health data retention pass failed: ${message}`);
      Sentry.captureMessage("Health data retention pass failed", {
        level: "error",
        tags: { rgpd: "retention-purge-failed", trigger },
        extra: { error: message },
      });
    }
  }

  async purgeExpiredHealthData(): Promise<HealthDataPurgeReport> {
    // Sans stockage utilisable, la purge ne peut pas prouver qu'un fichier est
    // parti. Avancer quand même reviendrait à effacer les lignes et à laisser
    // les certificats dans le conteneur, sans plus aucun pointeur.
    if (!this.blobStorage.isEnabled()) {
      this.logger.warn(
        "Health data retention skipped: blob storage is not configured",
      );
      return { ...EMPTY_REPORT, skipped: true };
    }

    const dated = await this.dateLegacyDocuments();

    const due = await this.prisma.licenseRenewalDocument.findMany({
      where: {
        type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
        purgeDueAt: { lte: new Date() },
      },
      select: { id: true, filePath: true },
      orderBy: { purgeDueAt: "asc" },
      take: PURGE_BATCH_SIZE,
    });
    if (due.length === 0) return { ...EMPTY_REPORT, dated };

    // 1. Les données extraites d'abord : écriture en base, elle aboutit même si
    //    le stockage se comporte mal. Le texte du certificat ne survit donc pas
    //    à son échéance, quel que soit le sort du fichier.
    const stripped = await this.prisma.licenseRenewalDocument.updateMany({
      where: { id: { in: due.map((document) => document.id) } },
      data: { ocrData: Prisma.DbNull },
    });

    // 2. Le fichier, puis la ligne — et seulement pour les fichiers confirmés
    //    partis. Les autres restent échus et repassent à l'heure suivante.
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

    return {
      dated,
      due: due.length,
      stripped: stripped.count,
      purged: purgeable.length,
      retryLater: due.length - purgeable.length,
      skipped: false,
    };
  }

  /**
   * Renseigne `purgeDueAt` sur les lignes antérieures à son introduction.
   *
   * Le backfill vit ici, et pas dans la migration SQL : l'échéance se lit dans
   * `ocrData`, texte issu de l'OCR d'un document utilisateur. Une valeur de
   * forme plausible mais invalide ferait échouer un cast SQL, donc la migration,
   * donc le démarrage du conteneur. En TypeScript, elle retombe simplement sur
   * la règle de repli.
   *
   * Transitoire : une fois les lignes historiques datées, cette requête ne
   * ramène plus rien — les nouveaux documents reçoivent leur échéance à
   * l'écriture.
   */
  private async dateLegacyDocuments(): Promise<number> {
    const undated = await this.prisma.licenseRenewalDocument.findMany({
      where: {
        type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
        purgeDueAt: null,
      },
      select: { id: true, createdAt: true, ocrData: true },
      take: BACKFILL_BATCH_SIZE,
    });
    if (undated.length === 0) return 0;

    await this.prisma.$transaction(
      undated.map((document) =>
        this.prisma.licenseRenewalDocument.update({
          where: { id: document.id },
          data: { purgeDueAt: medicalCertificatePurgeDueAt(document) },
        }),
      ),
    );
    return undated.length;
  }
}
