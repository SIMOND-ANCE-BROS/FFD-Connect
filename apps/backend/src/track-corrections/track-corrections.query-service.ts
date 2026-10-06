import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, TrackCorrectionStatus } from "@prisma/client";
import { PaginationParamsDto } from "../common/dto/pagination-params.dto";
import { createPaginatedResponse } from "../common/utils/pagination.util";
import { PrismaService } from "../prisma/prisma.service";
import {
  trackCorrectionAdminSelect,
  trackCorrectionMineSelect,
} from "../utils/prisma-selects";
import {
  MyTrackCorrectionPageDto,
  TrackCorrectionAdminDto,
  TrackCorrectionAdminPageDto,
} from "./dto/track-correction-response.dto";
import { ListTrackCorrectionsQueryDto } from "./dto/track-correction.dto";
import { toAdminDto, toMineDto } from "./track-correction.mapper";

const DEFAULT_SKIP = 0;
const DEFAULT_TAKE = 10;

/**
 * Lectures des propositions de correction : file de modération (ADMIN),
 * propositions de l'appelant et compteur pour le badge admin.
 */
@Injectable()
export class TrackCorrectionsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * File de modération. Les propositions EN ATTENTE sont servies de la plus
   * ancienne à la plus récente (premier arrivé, premier traité) ; l'historique
   * (validées/refusées/toutes) de la plus récente à la plus ancienne.
   */
  async listForAdmin(
    query: ListTrackCorrectionsQueryDto,
  ): Promise<TrackCorrectionAdminPageDto> {
    const skip = query.skip ?? DEFAULT_SKIP;
    const take = query.take ?? DEFAULT_TAKE;
    const where: Prisma.TrackCorrectionWhereInput = query.status
      ? { status: query.status }
      : {};
    const orderBy: Prisma.TrackCorrectionOrderByWithRelationInput = {
      createdAt:
        query.status === TrackCorrectionStatus.PENDING ? "asc" : "desc",
    };

    const [total, rows] = await Promise.all([
      this.prisma.trackCorrection.count({ where }),
      this.prisma.trackCorrection.findMany({
        where,
        orderBy,
        skip,
        take,
        select: trackCorrectionAdminSelect,
      }),
    ]);

    return createPaginatedResponse(rows.map(toAdminDto), total, skip, take);
  }

  /** Une proposition, vue administrateur (réponse de approve/reject). */
  async findOneForAdmin(id: string): Promise<TrackCorrectionAdminDto> {
    const row = await this.prisma.trackCorrection.findUnique({
      where: { id },
      select: trackCorrectionAdminSelect,
    });
    if (!row) {
      throw new NotFoundException(`Track correction ${id} not found`);
    }
    return toAdminDto(row);
  }

  /** Les propositions de l'appelant, de la plus récente à la plus ancienne. */
  async listMine(
    userId: string,
    pagination: PaginationParamsDto,
  ): Promise<MyTrackCorrectionPageDto> {
    const skip = pagination.skip ?? DEFAULT_SKIP;
    const take = pagination.take ?? DEFAULT_TAKE;
    const where: Prisma.TrackCorrectionWhereInput = { proposedById: userId };

    const [total, rows] = await Promise.all([
      this.prisma.trackCorrection.count({ where }),
      this.prisma.trackCorrection.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: trackCorrectionMineSelect,
      }),
    ]);

    return createPaginatedResponse(rows.map(toMineDto), total, skip, take);
  }

  /** Nombre de propositions en attente (badge de l'écran de modération). */
  async countPending(): Promise<number> {
    return this.prisma.trackCorrection.count({
      where: { status: TrackCorrectionStatus.PENDING },
    });
  }
}
