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
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateTrackDto } from "../tracks/dto/update-track.dto";
import { MASKED_TITLE_LABEL, TracksService } from "../tracks/tracks.service";
import {
  idOnlySelect,
  trackCorrectionDecisionSelect,
  trackCorrectionMineSelect,
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

/** Borne de la lecture des administrateurs à notifier. */
export const MAX_ADMINS_NOTIFIED = 100;

/** Titre de la notification admin pour une nouvelle proposition. */
export const NEW_CORRECTION_NOTIFICATION_TITLE = "Proposition de correction";

type CorrectionTarget = Prisma.TrackGetPayload<{
  select: typeof trackCorrectionTargetSelect;
}>;

type CorrectionForDecision = Prisma.TrackCorrectionGetPayload<{
  select: typeof trackCorrectionDecisionSelect;
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
  ) {}

  /**
   * Nouvelle proposition (POST /track-corrections). Seules les valeurs qui
   * diffèrent de la piste actuelle sont conservées ; il faut au moins l'une
   * d'elles ou un message.
   */
  async create(
    userId: string,
    dto: CreateTrackCorrectionDto,
  ): Promise<MyTrackCorrectionDto> {
    const track = await this.findTarget(dto.trackId);
    const proposed = TrackCorrectionsService.diff(dto, track);
    const message = normalizeText(dto.message);

    if (!TrackCorrectionsService.hasProposal(proposed) && !message) {
      throw new BadRequestException(
        "Aucune correction proposée : indiquez une valeur différente de l'actuelle ou un message.",
      );
    }
    if (await this.isPendingCapReached(userId, dto.trackId)) {
      throw new HttpException(
        `Vous avez déjà ${MAX_PENDING_CORRECTIONS_PER_USER_PER_TRACK} propositions en attente sur cette musique. Attendez la décision d'un administrateur.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const row = await this.prisma.trackCorrection.create({
      data: {
        trackId: dto.trackId,
        proposedById: userId,
        reason: dto.reason,
        message: message ?? null,
        ...proposed,
      },
      select: trackCorrectionMineSelect,
    });

    await this.notifyAdmins(
      row.id,
      dto.trackId,
      track.title,
      dto.reason,
      proposed,
      message,
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
  ): Promise<void> {
    const track = await this.findTarget(trackId);
    if (await this.isPendingCapReached(userId, trackId)) {
      this.logger.log(
        `Legacy track report on ${trackId} by ${userId} ignored: pending cap reached`,
      );
      return;
    }
    const trimmed = normalizeText(message);
    const row = await this.prisma.trackCorrection.create({
      data: {
        trackId,
        proposedById: userId,
        reason,
        message: trimmed ?? null,
      },
      select: idOnlySelect,
    });
    await this.notifyAdmins(
      row.id,
      trackId,
      track.title,
      reason,
      TrackCorrectionsService.EMPTY_PROPOSAL,
      trimmed,
    );
  }

  /**
   * Valide une proposition et l'applique à la piste via
   * TracksService.updateTrack (mêmes règles que l'édition admin : MPM
   * recalculé au changement de danse, clashs dédupliqués et triés). Les
   * valeurs du corps remplacent celles de la proposition.
   *
   * Le passage PENDING → APPROVED et la mise à jour de la piste partagent une
   * transaction : si l'application échoue, la proposition reste en attente.
   * La garde `updateMany … status: PENDING` refuse une double décision (409).
   */
  async approve(
    id: string,
    adminId: string,
    dto: ApproveTrackCorrectionDto,
  ): Promise<TrackCorrectionAdminDto> {
    const correction = await this.findPendingForDecision(id);
    const patch = TrackCorrectionsService.buildPatch(correction, dto);
    const comment = normalizeText(dto.comment) ?? null;

    await this.prisma.$transaction(async (tx) => {
      await TrackCorrectionsService.claim(
        tx,
        id,
        adminId,
        TrackCorrectionStatus.APPROVED,
        comment,
      );
      await this.tracksService.updateTrack(
        correction.trackId,
        adminId,
        true,
        patch,
      );
    });

    await this.notifyProposer(
      correction,
      TrackCorrectionStatus.APPROVED,
      comment,
      patch.title ?? correction.track.title,
    );
    this.logger.log(`Track correction ${id} approved by ${adminId}`);
    return this.queryService.findOneForAdmin(id);
  }

  /** Refuse une proposition. Même garde contre la double décision (409). */
  async reject(
    id: string,
    adminId: string,
    dto: RejectTrackCorrectionDto,
  ): Promise<TrackCorrectionAdminDto> {
    const correction = await this.findPendingForDecision(id);
    const comment = normalizeText(dto.comment) ?? null;

    await TrackCorrectionsService.claim(
      this.prisma,
      id,
      adminId,
      TrackCorrectionStatus.REJECTED,
      comment,
    );

    await this.notifyProposer(
      correction,
      TrackCorrectionStatus.REJECTED,
      comment,
      correction.track.title,
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

  /** Piste visée : 404 si absente ou retirée de la bibliothèque. */
  private async findTarget(trackId: string): Promise<CorrectionTarget> {
    const track = await this.prisma.track.findUnique({
      where: { id: trackId },
      select: trackCorrectionTargetSelect,
    });
    if (!track || track.blacklisted) {
      throw new NotFoundException(`Track ${trackId} not found`);
    }
    return track;
  }

  private async isPendingCapReached(
    userId: string,
    trackId: string,
  ): Promise<boolean> {
    const pending = await this.prisma.trackCorrection.count({
      where: {
        proposedById: userId,
        trackId,
        status: TrackCorrectionStatus.PENDING,
      },
    });
    return pending >= MAX_PENDING_CORRECTIONS_PER_USER_PER_TRACK;
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
      proposedTitle:
        title !== undefined && title !== track.title ? title : null,
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

  /** Résumé lisible des valeurs proposées, pour la notification admin. */
  private static summarize(
    reason: TrackCorrectionReason,
    values: ProposedValues,
  ): string {
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
    message: string | undefined,
  ): Promise<void> {
    try {
      const admins = await this.prisma.user.findMany({
        where: { role: UserRole.ADMIN },
        select: idOnlySelect,
        take: MAX_ADMINS_NOTIFIED,
      });
      const body =
        `«${trackTitle}» — ${TrackCorrectionsService.summarize(reason, values)}` +
        (message ? ` : ${message}` : "");
      const data = { type: "TRACK_CORRECTION", correctionId, trackId };
      const results = await Promise.allSettled(
        admins.map((admin) =>
          this.notificationsService.createForUser(
            admin.id,
            NotificationType.TRACK_REPORT,
            NEW_CORRECTION_NOTIFICATION_TITLE,
            body,
            data,
          ),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        this.logger.warn(
          `Track correction ${correctionId}: ${failed}/${admins.length} admin notification(s) failed`,
        );
      }
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
    correction: CorrectionForDecision,
    status: TrackCorrectionStatus,
    comment: string | null,
    trackTitle: string,
  ): Promise<void> {
    if (!correction.proposedById) return;
    const approved = status === TrackCorrectionStatus.APPROVED;
    // L'auteur peut ne pas être admin : titre masqué → libellé neutre.
    const title = correction.track.titleMasked
      ? MASKED_TITLE_LABEL
      : trackTitle;
    const body =
      `«${title}» : votre proposition de correction a été ${approved ? "validée" : "refusée"}.` +
      (comment ? ` Commentaire : ${comment}` : "");
    try {
      await this.notificationsService.createForUser(
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
