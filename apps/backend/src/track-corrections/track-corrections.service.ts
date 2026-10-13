import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  NotificationType,
  Prisma,
  TrackCorrectionReason,
  TrackCorrectionStatus,
  UserRole,
} from "@prisma/client";
import { AdminAuditService } from "../admin/admin-audit.service";
import { diffFields } from "../admin/admin-audit.util";
import type { AuditEntry } from "../admin/dto/admin-audit.dto";
import { withActiveRole } from "../auth/roles";
import { MAX_ADMINS_NOTIFIED } from "../notifications/admin-recipients";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateTrackDto } from "../tracks/dto/update-track.dto";
import {
  publicTrackName,
  trackByIdWhere,
  TrackVisibilityFields,
} from "../tracks/track-visibility.util";
import { TracksService } from "../tracks/tracks.service";
import {
  idOnlySelect,
  trackCorrectionAuditTrackSelect,
  trackCorrectionDecisionSelect,
  trackCorrectionMineSelect,
  trackCorrectionSupersededSelect,
  trackCorrectionTargetSelect,
} from "../utils/prisma-selects";
import {
  MyTrackCorrectionDto,
  TrackCorrectionAdminDto,
} from "./dto/track-correction-response.dto";
import {
  ApproveTrackCorrectionDto,
  CreateTrackCorrectionDto,
  RejectTrackCorrectionDto,
  TrackCorrectionValuesDto,
} from "./dto/track-correction.dto";
import {
  TRACK_CORRECTION_REASON_LABELS,
  toMineDto,
} from "./track-correction.mapper";
import { TrackCorrectionsQueryService } from "./track-corrections.query-service";

/**
 * Plafond de propositions EN ATTENTE par utilisateur et par piste. Au-delà,
 * l'utilisateur doit attendre la décision : la file de modération n'a pas à
 * absorber un même avis répété.
 */
export const MAX_PENDING_CORRECTIONS_PER_USER_PER_TRACK = 3;

/**
 * Plafond GLOBAL de propositions en attente par utilisateur, toutes pistes
 * confondues : borne ce qu'un seul compte peut déverser dans la file.
 */
export const MAX_PENDING_CORRECTIONS_PER_USER = 20;

/**
 * Tentatives d'une insertion plafonnée en isolation SERIALIZABLE. Deux
 * propositions concurrentes du même utilisateur font échouer l'une d'elles
 * (P2034, conflit de sérialisation) : on la rejoue, elle relit alors le
 * compteur à jour.
 */
export const MAX_SERIALIZABLE_ATTEMPTS = 3;

/** Titre de la notification admin pour une nouvelle proposition. */
export const NEW_CORRECTION_NOTIFICATION_TITLE = "Proposition de correction";

/**
 * Commentaire des autres propositions en attente d'une musique retirée de la
 * bibliothèque par une proposition de suppression acceptée (#446) : elles
 * sont refusées d'office, leur objet n'existant plus pour les utilisateurs.
 */
export const TRACK_REMOVED_REJECTION_COMMENT =
  "Musique retirée de la bibliothèque";

/**
 * Borne des propositions refusées d'office à l'acceptation d'une suppression.
 * Au-delà (improbable : 3 en attente au plus par utilisateur et par musique),
 * le reliquat reste dans la file, où l'administrateur le tranche à la main.
 */
export const MAX_SUPERSEDED_CORRECTIONS = 200;

type CorrectionTarget = Prisma.TrackGetPayload<{
  select: typeof trackCorrectionTargetSelect;
}>;

type CorrectionForDecision = Prisma.TrackCorrectionGetPayload<{
  select: typeof trackCorrectionDecisionSelect;
}>;

type TrackAuditFields = Prisma.TrackGetPayload<{
  select: typeof trackCorrectionAuditTrackSelect;
}>;

/** Valeurs réellement proposées (null = pas de proposition sur ce champ). */
interface ProposedValues {
  proposedTitle: string | null;
  proposedArtist: string | null;
  proposedStyle: string | null;
  proposedBpm: number | null;
  proposesClashes: boolean;
  proposedClashTimecodes: number[];
}

/**
 * Plafond atteint par une insertion (cf. createWithinCaps). `duplicate` : une
 * proposition du même motif unique (suppression) attend déjà sur la piste.
 */
type PendingCap = "per-track" | "global" | "duplicate";

/** Destinataire d'une décision (auteur d'une proposition tranchée). */
type DecisionRecipient = Pick<
  CorrectionForDecision,
  "id" | "trackId" | "proposedById"
> & { reason?: TrackCorrectionReason };

type SupersededCorrection = Prisma.TrackCorrectionGetPayload<{
  select: typeof trackCorrectionSupersededSelect;
}>;

type CappedInsert<T> = { created: T } | { capped: PendingCap };

/** Chaîne nettoyée ; vide ou absente → undefined (pas de valeur). */
const normalizeText = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
};

/** Même normalisation que TracksService.updateTrack : dédupliqués, triés. */
const normalizeClashes = (values: readonly number[]): number[] =>
  [...new Set(values)].sort((a, b) => a - b);

const sameNumbers = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/**
 * Écritures sur les propositions de correction de pistes : création (nouvelle
 * route et signalement historique), validation et refus par un administrateur.
 */
@Injectable()
export class TrackCorrectionsService {
  private readonly logger = new Logger(TrackCorrectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tracksService: TracksService,
    private readonly notificationsService: NotificationsService,
    private readonly queryService: TrackCorrectionsQueryService,
    private readonly audit: AdminAuditService,
  ) {}

  /**
   * Nouvelle proposition (POST /track-corrections). Seules les valeurs qui
   * diffèrent de la piste actuelle sont conservées ; il faut au moins l'une
   * d'elles ou un message.
   */
  async create(
    userId: string,
    dto: CreateTrackCorrectionDto,
    isAdmin = false,
  ): Promise<MyTrackCorrectionDto> {
    const track = await this.findTarget(dto.trackId, isAdmin);
    const deletion = dto.reason === TrackCorrectionReason.DELETE;
    // A deletion request carries no value: only its reason, in the message.
    const proposed = deletion
      ? TrackCorrectionsService.EMPTY_PROPOSAL
      : TrackCorrectionsService.diff(dto, track);
    const message = normalizeText(dto.message);

    if (deletion && !message) {
      throw new BadRequestException(
        "Indiquez pourquoi retirer cette musique (doublon, mauvais fichier…).",
      );
    }
    if (!TrackCorrectionsService.hasProposal(proposed) && !message) {
      throw new BadRequestException(
        "Aucune correction proposée : indiquez une valeur différente de l'actuelle ou un message.",
      );
    }
    const result = await this.createWithinCaps(
      userId,
      dto.trackId,
      (tx) =>
        tx.trackCorrection.create({
          data: {
            trackId: dto.trackId,
            proposedById: userId,
            reason: dto.reason,
            message: message ?? null,
            ...proposed,
          },
          select: trackCorrectionMineSelect,
        }),
      // One pending deletion request per user and per track.
      deletion ? TrackCorrectionReason.DELETE : undefined,
    );
    if ("capped" in result) {
      if (result.capped === "duplicate") {
        throw new ConflictException(
          "Vous avez déjà proposé la suppression de cette musique. Attendez la décision d'un administrateur.",
        );
      }
      throw new HttpException(
        result.capped === "per-track"
          ? `Vous avez déjà ${MAX_PENDING_CORRECTIONS_PER_USER_PER_TRACK} propositions en attente sur cette musique. Attendez la décision d'un administrateur.`
          : `Vous avez déjà ${MAX_PENDING_CORRECTIONS_PER_USER} propositions en attente. Attendez la décision d'un administrateur.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const row = result.created;

    await this.notifyAdmins(
      row.id,
      dto.trackId,
      track.title,
      dto.reason,
      proposed,
    );
    this.logger.log(
      `Track correction ${row.id} on track ${dto.trackId} proposed by ${userId}`,
    );
    return toMineDto(row);
  }

  /**
   * Signalement historique (POST /tracks/:id/report), toujours appelé par les
   * versions de l'application déjà installées. Le motif seul suffit (c'était
   * le contrat) ; le signalement entre dans la même file de modération.
   *
   * Plafond atteint : rien n'est créé, SANS erreur — l'ancien client ne
   * connaît que 204 et n'a pas à découvrir un nouveau code d'échec.
   */
  async createFromLegacyReport(
    trackId: string,
    reason: TrackCorrectionReason,
    message: string | undefined,
    userId: string,
    isAdmin = false,
  ): Promise<void> {
    const track = await this.findTarget(trackId, isAdmin);
    const trimmed = normalizeText(message);
    const result = await this.createWithinCaps(userId, trackId, (tx) =>
      tx.trackCorrection.create({
        data: {
          trackId,
          proposedById: userId,
          reason,
          message: trimmed ?? null,
        },
        select: idOnlySelect,
      }),
    );
    if ("capped" in result) {
      this.logger.log(
        `Legacy track report on ${trackId} by ${userId} ignored: ${result.capped} pending cap reached`,
      );
      return;
    }
    await this.notifyAdmins(
      result.created.id,
      trackId,
      track.title,
      reason,
      TrackCorrectionsService.EMPTY_PROPOSAL,
    );
  }

  /**
   * Valide une proposition et l'applique à la piste via
   * TracksService.updateTrack (mêmes règles que l'édition admin : MPM
   * recalculé au changement de danse, clashs dédupliqués et triés). Les
   * valeurs du corps remplacent celles de la proposition.
   *
   * Le passage PENDING → APPROVED et la mise à jour de la piste partagent la
   * MÊME transaction (updateTrack reçoit `tx`) : si l'application échoue, la
   * proposition reste en attente, et inversement.
   * La garde `updateMany … status: PENDING` refuse une double décision (409).
   *
   * The audit row (same transaction) holds the track fields really changed,
   * read back after updateTrack; nothing is logged if any step fails.
   */
  async approve(
    id: string,
    adminId: string,
    dto: ApproveTrackCorrectionDto,
  ): Promise<TrackCorrectionAdminDto> {
    const correction = await this.findPendingForDecision(id);
    const comment = normalizeText(dto.comment) ?? null;
    if (correction.reason === TrackCorrectionReason.DELETE) {
      return this.approveDeletion(correction, adminId, comment);
    }
    const patch = TrackCorrectionsService.buildPatch(correction, dto);

    await this.prisma.$transaction(async (tx) => {
      await TrackCorrectionsService.claim(
        tx,
        id,
        adminId,
        TrackCorrectionStatus.APPROVED,
        comment,
      );
      const before = await tx.track.findUnique({
        where: { id: correction.trackId },
        select: trackCorrectionAuditTrackSelect,
      });
      // skipAudit: this decision is logged once, as TRACK_CORRECTION_APPROVE.
      await this.tracksService.updateTrack(
        correction.trackId,
        adminId,
        true,
        patch,
        tx,
        { skipAudit: true },
      );
      const after = await tx.track.findUnique({
        where: { id: correction.trackId },
        select: trackCorrectionAuditTrackSelect,
      });
      await this.audit.record(
        tx,
        TrackCorrectionsService.approvalAudit(
          id,
          adminId,
          correction.trackId,
          before,
          after,
        ),
      );
    });

    await this.notifyProposer(
      correction,
      TrackCorrectionStatus.APPROVED,
      comment,
      { ...correction.track, title: patch.title ?? correction.track.title },
    );
    this.logger.log(`Track correction ${id} approved by ${adminId}`);
    return this.queryService.findOneForAdmin(id);
  }

  /**
   * Validation d'une proposition de suppression (#446) : la musique est
   * MASQUÉE (`blacklisted = true`, hors bibliothèque), jamais supprimée — la
   * suppression définitive reste l'action admin DELETE /tracks/:id. Les
   * valeurs éventuelles du corps sont ignorées.
   *
   * Dans la même transaction : passage PENDING → APPROVED (garde 409), masquage
   * via TracksService.updateTrack, ligne d'audit TRACK_CORRECTION_APPROVE
   * (blacklisted false → true) et refus d'office des autres propositions en
   * attente sur la musique (TRACK_REMOVED_REJECTION_COMMENT), une ligne
   * TRACK_CORRECTION_REJECT chacune. Leurs auteurs sont ensuite prévenus.
   */
  private async approveDeletion(
    correction: CorrectionForDecision,
    adminId: string,
    comment: string | null,
  ): Promise<TrackCorrectionAdminDto> {
    const { id, trackId } = correction;
    let superseded: SupersededCorrection[] = [];

    await this.prisma.$transaction(async (tx) => {
      await TrackCorrectionsService.claim(
        tx,
        id,
        adminId,
        TrackCorrectionStatus.APPROVED,
        comment,
      );
      const before = await tx.track.findUnique({
        where: { id: trackId },
        select: trackCorrectionAuditTrackSelect,
      });
      await this.tracksService.updateTrack(
        trackId,
        adminId,
        true,
        { blacklisted: true },
        tx,
        { skipAudit: true },
      );
      const after = await tx.track.findUnique({
        where: { id: trackId },
        select: trackCorrectionAuditTrackSelect,
      });
      await this.audit.record(
        tx,
        TrackCorrectionsService.approvalAudit(
          id,
          adminId,
          trackId,
          before,
          after,
        ),
      );
      superseded = await this.rejectSuperseded(tx, trackId, id, adminId);
    });

    // The authors knew the track: name it as it was before it was hidden.
    await this.notifyProposer(
      correction,
      TrackCorrectionStatus.APPROVED,
      comment,
      correction.track,
    );
    await Promise.all(
      superseded.map((row) =>
        this.notifyProposer(
          { ...row, trackId },
          TrackCorrectionStatus.REJECTED,
          TRACK_REMOVED_REJECTION_COMMENT,
          correction.track,
        ),
      ),
    );
    this.logger.log(
      `Track deletion request ${id} approved by ${adminId}: track ${trackId} hidden, ${superseded.length} pending proposal(s) rejected`,
    );
    return this.queryService.findOneForAdmin(id);
  }

  /**
   * Refuse d'office les autres propositions en attente d'une musique retirée.
   * Chaque passage est conditionnel (PENDING) : une proposition tranchée en
   * parallèle par un autre administrateur garde sa décision et n'est ni
   * journalisée ni notifiée ici.
   */
  private async rejectSuperseded(
    tx: Prisma.TransactionClient,
    trackId: string,
    approvedId: string,
    adminId: string,
  ): Promise<SupersededCorrection[]> {
    const pending = await tx.trackCorrection.findMany({
      where: {
        trackId,
        status: TrackCorrectionStatus.PENDING,
        id: { not: approvedId },
      },
      select: trackCorrectionSupersededSelect,
      orderBy: { createdAt: "asc" },
      take: MAX_SUPERSEDED_CORRECTIONS,
    });
    const rejected: SupersededCorrection[] = [];
    for (const row of pending) {
      const { count } = await tx.trackCorrection.updateMany({
        where: { id: row.id, status: TrackCorrectionStatus.PENDING },
        data: {
          status: TrackCorrectionStatus.REJECTED,
          reviewedById: adminId,
          reviewComment: TRACK_REMOVED_REJECTION_COMMENT,
          reviewedAt: new Date(),
        },
      });
      if (count === 0) continue;
      await this.audit.record(tx, {
        actorId: adminId,
        action: "TRACK_CORRECTION_REJECT",
        targetType: "TRACK_CORRECTION",
        targetId: row.id,
        after: { trackId },
      });
      rejected.push(row);
    }
    return rejected;
  }

  /** Refuse une proposition. Même garde contre la double décision (409). */
  async reject(
    id: string,
    adminId: string,
    dto: RejectTrackCorrectionDto,
  ): Promise<TrackCorrectionAdminDto> {
    const correction = await this.findPendingForDecision(id);
    const comment = normalizeText(dto.comment) ?? null;

    // Claim and audit row are atomic: a 409 leaves no trace.
    await this.prisma.$transaction(async (tx) => {
      await TrackCorrectionsService.claim(
        tx,
        id,
        adminId,
        TrackCorrectionStatus.REJECTED,
        comment,
      );
      await this.audit.record(tx, {
        actorId: adminId,
        action: "TRACK_CORRECTION_REJECT",
        targetType: "TRACK_CORRECTION",
        targetId: id,
        // Track metadata only: never the proposer's message nor the comment.
        after: { trackId: correction.trackId },
      });
    });

    await this.notifyProposer(
      correction,
      TrackCorrectionStatus.REJECTED,
      comment,
      correction.track,
    );
    this.logger.log(`Track correction ${id} rejected by ${adminId}`);
    return this.queryService.findOneForAdmin(id);
  }

  // ── Internes ──────────────────────────────────────────────────────────────

  private static readonly EMPTY_PROPOSAL: ProposedValues = {
    proposedTitle: null,
    proposedArtist: null,
    proposedStyle: null,
    proposedBpm: null,
    proposesClashes: false,
    proposedClashTimecodes: [],
  };

  /**
   * Piste visée. Pour un non-admin : 404 si absente ou hors bibliothèque
   * (blacklistée, non READY, Ambiance), sans distinction possible. Un admin
   * atteint toute piste existante.
   */
  private async findTarget(
    trackId: string,
    isAdmin: boolean,
  ): Promise<CorrectionTarget> {
    const track = await this.prisma.track.findFirst({
      where: trackByIdWhere(trackId, isAdmin),
      select: trackCorrectionTargetSelect,
    });
    if (!track) {
      throw new NotFoundException(`Track ${trackId} not found`);
    }
    return track;
  }

  /**
   * Insère une proposition si l'utilisateur est sous ses deux plafonds de
   * propositions en attente (par piste et global).
   *
   * Compter puis insérer n'est sûr que si les deux lectures et l'écriture sont
   * sérialisées : en READ COMMITTED, deux requêtes simultanées liraient le même
   * compteur et passeraient toutes deux. La transaction est donc SERIALIZABLE ;
   * PostgreSQL fait échouer l'une des deux (P2034), qui est rejouée et voit
   * alors le compteur à jour.
   */
  private async createWithinCaps<T>(
    userId: string,
    trackId: string,
    insert: (tx: Prisma.TransactionClient) => Promise<T>,
    uniqueReason?: TrackCorrectionReason,
  ): Promise<CappedInsert<T>> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.prisma.$transaction(
          async (tx): Promise<CappedInsert<T>> => {
            const pending = {
              proposedById: userId,
              status: TrackCorrectionStatus.PENDING,
            };
            if (uniqueReason) {
              const same = await tx.trackCorrection.count({
                where: { ...pending, trackId, reason: uniqueReason },
              });
              if (same > 0) return { capped: "duplicate" };
            }
            const onTrack = await tx.trackCorrection.count({
              where: { ...pending, trackId },
            });
            if (onTrack >= MAX_PENDING_CORRECTIONS_PER_USER_PER_TRACK) {
              return { capped: "per-track" };
            }
            const total = await tx.trackCorrection.count({ where: pending });
            if (total >= MAX_PENDING_CORRECTIONS_PER_USER) {
              return { capped: "global" };
            }
            return { created: await insert(tx) };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        const serializationFailure =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034";
        if (!serializationFailure) throw error;
        if (attempt >= MAX_SERIALIZABLE_ATTEMPTS) {
          throw new ConflictException(
            "Trop de propositions simultanées, réessayez dans un instant.",
          );
        }
      }
    }
  }

  /** Ne garde que les valeurs qui diffèrent réellement de la piste. */
  private static diff(
    values: TrackCorrectionValuesDto,
    track: CorrectionTarget,
  ): ProposedValues {
    const title = normalizeText(values.title);
    const artist = normalizeText(values.artist);
    const style = normalizeText(values.style);
    const clashes =
      values.clashTimecodes !== undefined
        ? normalizeClashes(values.clashTimecodes)
        : undefined;
    const proposesClashes =
      clashes !== undefined &&
      !sameNumbers(clashes, normalizeClashes(track.clashTimecodes));

    return {
      // Titre masqué : jamais comparé au titre réel. Sinon la réponse (400
      // « aucune correction » ou valeur ignorée) servirait d'oracle à un
      // non-admin pour deviner le titre que la modération lui cache.
      proposedTitle:
        title !== undefined && (track.titleMasked || title !== track.title)
          ? title
          : null,
      proposedArtist:
        artist !== undefined && artist !== track.artist ? artist : null,
      // La danse est un texte libre : « rumba » et « Rumba » sont la même.
      proposedStyle:
        style !== undefined &&
        style.toLowerCase() !== (track.style ?? "").toLowerCase()
          ? style
          : null,
      proposedBpm:
        values.bpm !== undefined && values.bpm !== track.bpm
          ? values.bpm
          : null,
      proposesClashes,
      proposedClashTimecodes: proposesClashes ? clashes : [],
    };
  }

  private static hasProposal(values: ProposedValues): boolean {
    return (
      values.proposedTitle !== null ||
      values.proposedArtist !== null ||
      values.proposedStyle !== null ||
      values.proposedBpm !== null ||
      values.proposesClashes
    );
  }

  /** Patch appliqué à la piste : valeurs de l'admin, sinon de la proposition. */
  private static buildPatch(
    correction: CorrectionForDecision,
    dto: TrackCorrectionValuesDto,
  ): UpdateTrackDto {
    const patch: UpdateTrackDto = {};
    const title = normalizeText(dto.title) ?? correction.proposedTitle;
    const artist = normalizeText(dto.artist) ?? correction.proposedArtist;
    const style = normalizeText(dto.style) ?? correction.proposedStyle;
    const bpm = dto.bpm ?? correction.proposedBpm;
    const clashes =
      dto.clashTimecodes ??
      (correction.proposesClashes
        ? correction.proposedClashTimecodes
        : undefined);

    if (title !== null) patch.title = title;
    if (artist !== null) patch.artist = artist;
    if (style !== null) patch.style = style;
    if (bpm !== null) patch.bpm = bpm;
    if (clashes !== undefined) patch.clashTimecodes = clashes;
    return patch;
  }

  /** 404 si inconnue, 409 si déjà tranchée. */
  private async findPendingForDecision(
    id: string,
  ): Promise<CorrectionForDecision> {
    const correction = await this.prisma.trackCorrection.findUnique({
      where: { id },
      select: trackCorrectionDecisionSelect,
    });
    if (!correction) {
      throw new NotFoundException(`Track correction ${id} not found`);
    }
    if (correction.status !== TrackCorrectionStatus.PENDING) {
      throw TrackCorrectionsService.alreadyDecided();
    }
    return correction;
  }

  /**
   * Passe la proposition de PENDING à `status`. Conditionnel sur l'état : si
   * un autre administrateur a tranché entre la lecture et l'écriture, rien
   * n'est modifié et la décision est refusée (409).
   */
  private static async claim(
    client: Prisma.TransactionClient,
    id: string,
    adminId: string,
    status: TrackCorrectionStatus,
    comment: string | null,
  ): Promise<void> {
    const { count } = await client.trackCorrection.updateMany({
      where: { id, status: TrackCorrectionStatus.PENDING },
      data: {
        status,
        reviewedById: adminId,
        reviewComment: comment,
        reviewedAt: new Date(),
      },
    });
    if (count === 0) {
      throw TrackCorrectionsService.alreadyDecided();
    }
  }

  private static alreadyDecided(): ConflictException {
    return new ConflictException("Cette proposition a déjà été traitée.");
  }

  /**
   * Audit row of an approval: the track fields the approval actually changed
   * plus trackId. Never the proposer's message nor the review comment (free
   * text that may hold personal data).
   */
  private static approvalAudit(
    id: string,
    adminId: string,
    trackId: string,
    before: TrackAuditFields | null,
    after: TrackAuditFields | null,
  ): AuditEntry {
    const changes = diffFields(before ?? {}, after ?? {});
    return {
      actorId: adminId,
      action: "TRACK_CORRECTION_APPROVE",
      targetType: "TRACK_CORRECTION",
      targetId: id,
      before: { trackId, ...changes?.before },
      after: { trackId, ...changes?.after },
    };
  }

  /** Résumé lisible des valeurs proposées, pour la notification admin. */
  private static summarize(
    reason: TrackCorrectionReason,
    values: ProposedValues,
  ): string {
    if (reason === TrackCorrectionReason.DELETE) {
      return "Suppression de la musique demandée";
    }
    const parts: string[] = [];
    if (values.proposedTitle !== null) {
      parts.push(`Titre « ${values.proposedTitle} »`);
    }
    if (values.proposedArtist !== null) {
      parts.push(`Artiste « ${values.proposedArtist} »`);
    }
    if (values.proposedStyle !== null) {
      parts.push(`Danse ${values.proposedStyle}`);
    }
    if (values.proposedBpm !== null) {
      parts.push(`MPM proposé ${values.proposedBpm}`);
    }
    if (values.proposesClashes) {
      parts.push(
        values.proposedClashTimecodes.length > 0
          ? `Clashs ${values.proposedClashTimecodes.join(" s, ")} s`
          : "Aucun clash",
      );
    }
    return parts.length > 0
      ? parts.join(", ")
      : `${TRACK_CORRECTION_REASON_LABELS[reason]} signalé`;
  }

  /**
   * Notifie chaque administrateur (TRACK_REPORT). Best-effort : la
   * proposition est déjà enregistrée et visible dans la file, un échec
   * d'envoi ne doit pas la faire échouer côté utilisateur.
   */
  private async notifyAdmins(
    correctionId: string,
    trackId: string,
    trackTitle: string,
    reason: TrackCorrectionReason,
    values: ProposedValues,
  ): Promise<void> {
    try {
      const admins = await this.prisma.user.findMany({
        where: withActiveRole(UserRole.ADMIN),
        select: idOnlySelect,
        take: MAX_ADMINS_NOTIFIED,
      });
      // Le commentaire libre de l'auteur n'est PAS recopié ici : une
      // notification n'est pas effacée avec le compte de l'auteur (RGPD) ;
      // l'admin le lit dans la file, d'où il disparaît à la suppression.
      const body = `«${trackTitle}» — ${TrackCorrectionsService.summarize(reason, values)}`;
      const data = { type: "TRACK_CORRECTION", correctionId, trackId };
      // Push (#38) : une proposition appelle une décision de modération.
      // UN seul appel pour tous les administrateurs — le fil est écrit en une
      // requête et les push partent par paquets bornés, au lieu d'un
      // aller-retour en base par destinataire.
      await this.notificationsService.sendToUsers(
        admins.map((admin) => admin.id),
        NotificationType.TRACK_REPORT,
        NEW_CORRECTION_NOTIFICATION_TITLE,
        body,
        data,
      );
    } catch (error) {
      this.logger.warn(
        `Track correction ${correctionId}: admin notification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Informe l'auteur de la décision (TRACK_CORRECTION_DECISION), s'il existe
   * encore. Best-effort, comme notifyAdmins : la décision est déjà actée.
   */
  private async notifyProposer(
    correction: DecisionRecipient,
    status: TrackCorrectionStatus,
    comment: string | null,
    track: TrackVisibilityFields,
  ): Promise<void> {
    if (!correction.proposedById) return;
    const approved = status === TrackCorrectionStatus.APPROVED;
    const deletion = correction.reason === TrackCorrectionReason.DELETE;
    // L'auteur peut ne pas être admin : même filtrage que partout côté
    // non-admin (titre masqué → libellé neutre, piste blacklistée → retirée).
    const { title } = publicTrackName(track);
    const outcome = deletion
      ? approved
        ? "votre proposition de suppression a été validée, la musique est retirée de la bibliothèque"
        : "votre proposition de suppression a été refusée"
      : `votre proposition de correction a été ${approved ? "validée" : "refusée"}`;
    const body =
      `«${title}» : ${outcome}.` + (comment ? ` Commentaire : ${comment}` : "");
    try {
      // Push (#38) : décision prise par un tiers sur SA proposition.
      await this.notificationsService.sendToUser(
        correction.proposedById,
        NotificationType.TRACK_CORRECTION_DECISION,
        approved ? "Proposition validée" : "Proposition refusée",
        body,
        {
          type: "TRACK_CORRECTION_DECISION",
          correctionId: correction.id,
          trackId: correction.trackId,
          status,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Track correction ${correction.id}: proposer notification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
