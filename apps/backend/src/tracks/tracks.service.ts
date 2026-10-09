import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, TrackCorrectionStatus, TrackStatus } from "@prisma/client";
import { AdminAuditService } from "../admin/admin-audit.service";
import { diffFields } from "../admin/admin-audit.util";
import { PaginationParamsDto } from "../common/dto/pagination-params.dto";
import { createPaginatedResponse } from "../common/utils/pagination.util";
import { PrismaService } from "../prisma/prisma.service";
import {
  idOnlySelect,
  trackAuditSelect,
  trackDeletionSelect,
  trackUpdateTargetSelect,
} from "../utils/prisma-selects";
import { BpmService } from "./bpm.service";
import { UpdateTrackDto } from "./dto/update-track.dto";
import { PASO_MAX_CLASHES, PASO_MAX_CLASHES_MESSAGE } from "./paso-clashes";
import { TrackFilesService } from "./track-files.service";
import {
  LIBRARY_TRACK_WHERE,
  MASKED_TITLE_LABEL,
  trackByIdWhere,
} from "./track-visibility.util";

/** 409 of DELETE /tracks/:id while correction proposals wait for a decision. */
export const TRACK_HAS_PENDING_CORRECTIONS_MESSAGE =
  "Des propositions de correction sont en attente sur cette musique : traitez-les dans Modération, ou blacklistez la musique.";

export interface UpdateTrackOptions {
  /**
   * No TRACK_UPDATE row: the caller writes its own audit row in the same
   * transaction (a correction approval logs TRACK_CORRECTION_APPROVE).
   */
  skipAudit?: boolean;
}

/** Champs de base récupérés pour toute piste audio. Ne pas exposer status/jobId dans les listes. */
const TRACK_BASE_SELECT = {
  id: true,
  title: true,
  artist: true,
  filename: true,
  artwork: true,
  style: true,
  bpm: true,
  // Raw detected tempo (BPM) — lets the client preview the dance-aware MPM
  // live before saving. submittedById drives the edit permission (owner/admin).
  rawBpm: true,
  submittedById: true,
  // Modération : renvoyés au client. titleMasked pilote l'affichage du libellé
  // neutre côté non-admin ; blacklisted permet à l'admin d'afficher un indicateur.
  titleMasked: true,
  blacklisted: true,
  // Paso doble : timecodes des appels affichés sur le lecteur (#paso-clashes).
  clashTimecodes: true,
  createdAt: true,
} satisfies Prisma.TrackSelect;

type TrackBase = Prisma.TrackGetPayload<{ select: typeof TRACK_BASE_SELECT }>;

@Injectable()
export class TracksService {
  private readonly logger = new Logger(TracksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bpmService: BpmService,
    private readonly files: TrackFilesService,
    private readonly audit: AdminAuditService,
  ) {}

  /** Nombre maximal de pistes d'ambiance renvoyées (requête bornée). */
  static readonly AMBIANCE_TAKE = 50;

  /**
   * Filtre Prisma des pistes d'ambiance (musique de pause du mode compétition) :
   * style OU artiste « Ambiance » (insensible à la casse), READY, non blacklistées.
   * Exactement les pistes d'ambiance que LIBRARY_TRACK_WHERE exclut de la bibliothèque.
   */
  private static readonly AMBIANCE_WHERE: Prisma.TrackWhereInput = {
    AND: [
      {
        OR: [
          { style: { equals: "Ambiance", mode: "insensitive" } },
          { artist: { equals: "Ambiance", mode: "insensitive" } },
        ],
      },
      { status: TrackStatus.READY },
      { blacklisted: false },
    ],
  };

  /**
   * Applique le masquage du titre en fonction du rôle du demandeur.
   * Les admins voient toujours le titre réel (+ le flag titleMasked pour
   * afficher un indicateur). Les non-admins reçoivent un libellé neutre
   * lorsque la piste est marquée titleMasked.
   */
  private static maskTitle<T extends TrackBase>(track: T, isAdmin: boolean): T {
    if (track.titleMasked && !isAdmin) {
      return { ...track, title: MASKED_TITLE_LABEL };
    }
    return track;
  }

  /**
   * Récupère toutes les pistes audio READY avec pagination.
   * Exclut Ambiance et les tracks en cours de traitement.
   */
  async findAll(
    pagination: PaginationParamsDto = new PaginationParamsDto(),
    isAdmin = false,
  ) {
    const { skip, take } = pagination;
    const where = LIBRARY_TRACK_WHERE;

    const [total, tracks] = await Promise.all([
      this.prisma.track.count({ where }),
      this.prisma.track.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: TRACK_BASE_SELECT,
      }),
    ]);

    const masked = tracks.map((t) => TracksService.maskTitle(t, isAdmin));
    return createPaginatedResponse(masked, total, skip ?? 0, take ?? 10);
  }

  /**
   * Récupère les pistes d'ambiance (musique de pause du mode compétition),
   * exclues de la bibliothèque par LIBRARY_TRACK_WHERE. Même forme et même masquage
   * de titre que `findAll`, pour que le client les mappe à l'identique.
   */
  async findAmbiance(isAdmin = false): Promise<TrackBase[]> {
    const tracks = await this.prisma.track.findMany({
      where: TracksService.AMBIANCE_WHERE,
      orderBy: { createdAt: "desc" },
      take: TracksService.AMBIANCE_TAKE,
      select: TRACK_BASE_SELECT,
    });
    return tracks.map((t) => TracksService.maskTitle(t, isAdmin));
  }

  /**
   * Récupère une piste audio par son ID. Pour un non-admin, une piste hors
   * bibliothèque (blacklistée, non READY, Ambiance) renvoie le même 404
   * qu'une piste inexistante.
   */
  async findOne(id: string, isAdmin = false) {
    const track = await this.prisma.track.findFirst({
      where: trackByIdWhere(id, isAdmin),
      select: TRACK_BASE_SELECT,
    });
    if (!track) throw new NotFoundException(`Track ${id} not found`);
    return TracksService.maskTitle(track, isAdmin);
  }

  /**
   * Met à jour les champs éditables d'une track (titre, artiste, style, bpm).
   * Seul le submitter ou un admin peut éditer. Les champs non fournis sont préservés.
   *
   * Every applied change is audited (TRACK_UPDATE) in the same transaction,
   * whoever calls: back-office or mobile app. `client` is the caller's
   * interactive transaction when the update must be atomic with other writes
   * (correction approval); otherwise a transaction is opened here.
   */
  async updateTrack(
    id: string,
    userId: string,
    isAdmin: boolean,
    patch: UpdateTrackDto,
    client?: Prisma.TransactionClient,
    options: UpdateTrackOptions = {},
  ): Promise<void> {
    if (client) {
      await this.applyUpdate(client, id, userId, isAdmin, patch, options);
      return;
    }
    await this.prisma.$transaction((tx) =>
      this.applyUpdate(tx, id, userId, isAdmin, patch, options),
    );
  }

  private async applyUpdate(
    tx: Prisma.TransactionClient,
    id: string,
    userId: string,
    isAdmin: boolean,
    patch: UpdateTrackDto,
    options: UpdateTrackOptions,
  ): Promise<void> {
    const existing = await tx.track.findUnique({
      where: { id },
      select: trackUpdateTargetSelect,
    });
    if (!existing) {
      throw new NotFoundException(`Track ${id} not found`);
    }
    if (
      !isAdmin &&
      existing.submittedById &&
      existing.submittedById !== userId
    ) {
      throw new HttpException(
        "Vous ne pouvez modifier que les musiques que vous avez ajoutées.",
        HttpStatus.FORBIDDEN,
      );
    }
    const data: Prisma.TrackUpdateInput = {};
    if (patch.title !== undefined) data.title = patch.title;
    if (patch.artist !== undefined) data.artist = patch.artist;
    if (patch.style !== undefined) data.style = patch.style || null;
    // Champs de modération : réservés aux admins. Ignorés silencieusement pour
    // un non-admin (le contrôleur PATCH est déjà ADMIN-only, ceci est une
    // défense en profondeur).
    if (isAdmin && patch.titleMasked !== undefined) {
      data.titleMasked = patch.titleMasked;
    }
    if (isAdmin && patch.blacklisted !== undefined) {
      data.blacklisted = patch.blacklisted;
    }
    // Appels paso doble : données de compétition autoritaires → ADMIN only.
    // Triés croissants et dédupliqués pour un affichage stable sur le lecteur.
    // Au plus PASO_MAX_CLASHES : le DTO le garantit pour PATCH /tracks/:id,
    // mais la validation d'une proposition passe ici avec des valeurs stockées
    // avant l'introduction de cette borne.
    if (isAdmin && patch.clashTimecodes !== undefined) {
      const clashes = [...new Set(patch.clashTimecodes)].sort((a, b) => a - b);
      if (clashes.length > PASO_MAX_CLASHES) {
        throw new BadRequestException(PASO_MAX_CLASHES_MESSAGE);
      }
      data.clashTimecodes = clashes;
    }
    const bpm = this.bpmForPatch(existing.rawBpm, patch);
    if (bpm !== undefined) data.bpm = bpm;
    // A back-office import without a detectable tempo creates the track in
    // ERROR (out of the library): the admin who sets its MPM publishes it.
    if (
      isAdmin &&
      existing.status === TrackStatus.ERROR &&
      bpm !== undefined &&
      bpm > 0
    ) {
      data.status = TrackStatus.READY;
    }
    if (Object.keys(data).length === 0) return;
    const after = await tx.track.update({
      where: { id },
      data,
      select: trackAuditSelect,
    });
    this.logger.log(
      `Updated track ${id} (fields: ${Object.keys(data).join(",")})`,
    );
    if (options.skipAudit) return;
    // Read back inside the transaction: the row holds what was really applied
    // (MPM recalculated on a dance change, sorted clashes), not the request.
    const changes = diffFields(existing, after);
    if (!changes) return;
    await this.audit.record(tx, {
      actorId: userId,
      action: "TRACK_UPDATE",
      targetType: "TRACK",
      targetId: id,
      before: changes.before,
      after: changes.after,
    });
  }

  /**
   * Tempo (MPM) qu'un patch écrira sur la piste, ou undefined s'il n'y touche
   * pas. Source unique de la règle appliquée par updateTrack, exposée pour que
   * la file de modération affiche le MPM qui RÉSULTERA d'une validation :
   * - tempo explicite → il est appliqué tel quel ;
   * - sinon, changement de danse avec un tempo brut détecté → MPM recalculé
   *   depuis le BPM brut pour la nouvelle danse (en danse on parle en MPM).
   */
  bpmForPatch(
    rawBpm: number,
    patch: Pick<UpdateTrackDto, "bpm" | "style">,
  ): number | undefined {
    if (patch.bpm !== undefined) return patch.bpm;
    if (patch.style && rawBpm > 0) {
      const mpm = this.bpmService.calculateMpm(rawBpm, patch.style);
      if (mpm > 0) return mpm;
    }
    return undefined;
  }

  /**
   * Deletes a track for good (admin moderation, web or mobile). Refused (409)
   * while correction proposals wait for a decision: the deletion would cascade
   * them away unanswered. The row and its audit row share one transaction; the
   * audio and artwork files go afterwards, best-effort.
   */
  async deleteTrack(id: string, actorId: string): Promise<void> {
    const names = await this.prisma.$transaction(async (tx) => {
      const track = await tx.track.findUnique({
        where: { id },
        select: trackDeletionSelect,
      });
      if (!track) {
        throw new NotFoundException(`Track ${id} not found`);
      }
      const pendingCorrections = await tx.trackCorrection.count({
        where: { trackId: id, status: TrackCorrectionStatus.PENDING },
      });
      if (pendingCorrections > 0) {
        throw new ConflictException({
          message: TRACK_HAS_PENDING_CORRECTIONS_MESSAGE,
          pendingCorrections,
        });
      }
      await tx.track.delete({ where: { id }, select: idOnlySelect });
      await this.audit.record(tx, {
        actorId,
        action: "TRACK_DELETE",
        targetType: "TRACK",
        targetId: id,
        // Track metadata only.
        before: {
          title: track.title,
          artist: track.artist,
          sourceKey: track.sourceKey,
          filename: track.filename,
        },
      });
      return [track.filename, track.artwork].filter((name): name is string =>
        Boolean(name),
      );
    });
    await this.files.remove(names);
    this.logger.log(`Deleted track ${id}`);
  }
}
