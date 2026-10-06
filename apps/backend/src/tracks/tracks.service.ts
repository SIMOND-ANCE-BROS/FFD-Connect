import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, TrackStatus } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { PaginationParamsDto } from "../common/dto/pagination-params.dto";
import { createPaginatedResponse } from "../common/utils/pagination.util";
import { PrismaService } from "../prisma/prisma.service";
import { BlobStorageService } from "../storage/blob-storage.service";
import { BpmService } from "./bpm.service";
import { UpdateTrackDto } from "./dto/update-track.dto";
import { MASKED_TITLE_LABEL } from "./track-visibility.util";

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
    private readonly blobStorage: BlobStorageService,
  ) {}

  /**
   * Filtre Prisma : exclut Ambiance, les tracks en cours de traitement
   * (PENDING/ERROR) et les pistes blacklistées par un admin.
   */
  private static readonly LIBRARY_WHERE: Prisma.TrackWhereInput = {
    AND: [
      { artist: { not: { equals: "Ambiance" }, mode: "insensitive" } },
      {
        OR: [
          { style: { not: { equals: "Ambiance" }, mode: "insensitive" } },
          { style: null },
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
    const where = TracksService.LIBRARY_WHERE;

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
   * Récupère une piste audio par son ID.
   */
  async findOne(id: string, isAdmin = false) {
    const track = await this.prisma.track.findUnique({
      where: { id },
      select: TRACK_BASE_SELECT,
    });
    if (!track) throw new NotFoundException(`Track ${id} not found`);
    return TracksService.maskTitle(track, isAdmin);
  }

  /**
   * Met à jour les champs éditables d'une track (titre, artiste, style, bpm).
   * Seul le submitter ou un admin peut éditer. Les champs non fournis sont préservés.
   */
  async updateTrack(
    id: string,
    userId: string,
    isAdmin: boolean,
    patch: UpdateTrackDto,
    /**
     * Client Prisma à utiliser : celui d'une transaction interactive quand la
     * mise à jour doit être atomique avec d'autres écritures (validation d'une
     * proposition de correction), le client par défaut sinon.
     */
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    const existing = await client.track.findUnique({
      where: { id },
      select: { submittedById: true, rawBpm: true },
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
    if (isAdmin && patch.clashTimecodes !== undefined) {
      data.clashTimecodes = [...new Set(patch.clashTimecodes)].sort(
        (a, b) => a - b,
      );
    }
    const bpm = this.bpmForPatch(existing.rawBpm, patch);
    if (bpm !== undefined) data.bpm = bpm;
    if (Object.keys(data).length === 0) return;
    await client.track.update({ where: { id }, data });
    this.logger.log(
      `Updated track ${id} (fields: ${Object.keys(data).join(",")})`,
    );
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
   * Supprime définitivement une piste (modération admin). Retire la ligne DB
   * et, si possible, le fichier audio associé (blob ou disque local). L'échec
   * de suppression du fichier n'empêche pas la suppression de la ligne.
   */
  async deleteTrack(id: string): Promise<void> {
    const track = await this.prisma.track.findUnique({
      where: { id },
      select: { filename: true },
    });
    if (!track) {
      throw new NotFoundException(`Track ${id} not found`);
    }

    await this.prisma.track.delete({ where: { id } });

    if (track.filename) {
      await this.deleteAudioFile(track.filename);
    }
    this.logger.log(`Deleted track ${id}`);
  }

  /** Best-effort suppression du fichier audio (blob Azure ou disque local). */
  private async deleteAudioFile(filename: string): Promise<void> {
    const safeName = path.basename(filename);
    try {
      if (this.blobStorage.isEnabled()) {
        await this.blobStorage.deleteFile(safeName);
        return;
      }
      const filePath = path.join(__dirname, "../../uploads", safeName);
      await fs.promises.rm(filePath, { force: true });
    } catch (error) {
      // Non-fatal : la ligne DB est déjà supprimée, on ne bloque pas la modération.
      this.logger.warn(
        `Failed to delete audio file ${safeName}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
