import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createPaginatedResponse } from "../common/utils/pagination.util";
import { PrismaService } from "../prisma/prisma.service";
import { adminTrackSelect } from "../utils/prisma-selects";
import {
  AdminTrackDto,
  AdminTracksPageDto,
  ListAdminTracksQueryDto,
} from "./dto/admin-track.dto";
import {
  AMBIANCE_TRACK_WHERE,
  NOT_AMBIANCE_TRACK_WHERE,
} from "./track-visibility.util";

const DEFAULT_TAKE = 20;

type AdminTrackRow = Prisma.TrackGetPayload<{
  select: typeof adminTrackSelect;
}>;

export function toAdminTrackDto({
  _count,
  ...fields
}: AdminTrackRow): AdminTrackDto {
  return { ...fields, pendingCorrections: _count.corrections };
}

/** Catalogue filter: every track; LIBRARY_TRACK_WHERE is deliberately absent. */
export function adminTracksWhere(
  query: ListAdminTracksQueryDto,
): Prisma.TrackWhereInput {
  const and: Prisma.TrackWhereInput[] = [];
  if (query.q) {
    and.push({
      OR: [
        { title: { contains: query.q, mode: "insensitive" } },
        { artist: { contains: query.q, mode: "insensitive" } },
      ],
    });
  }
  if (query.status) and.push({ status: query.status });
  if (query.blacklisted !== undefined)
    and.push({ blacklisted: query.blacklisted });
  if (query.titleMasked !== undefined)
    and.push({ titleMasked: query.titleMasked });
  if (query.style)
    and.push({ style: { equals: query.style, mode: "insensitive" } });
  if (query.ambiance !== undefined) {
    and.push(query.ambiance ? AMBIANCE_TRACK_WHERE : NOT_AMBIANCE_TRACK_WHERE);
  }
  return and.length > 0 ? { AND: and } : {};
}

/** Reads of the back-office track catalogue. */
@Injectable()
export class AdminTracksQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListAdminTracksQueryDto): Promise<AdminTracksPageDto> {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const where = adminTracksWhere(query);
    const [total, rows] = await Promise.all([
      this.prisma.track.count({ where }),
      this.prisma.track.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
        select: adminTrackSelect,
      }),
    ]);
    return createPaginatedResponse(
      rows.map(toAdminTrackDto),
      total,
      skip,
      take,
    );
  }

  async detail(id: string): Promise<AdminTrackDto> {
    const row = await this.prisma.track.findUnique({
      where: { id },
      select: adminTrackSelect,
    });
    if (!row) throw new NotFoundException("Musique introuvable");
    return toAdminTrackDto(row);
  }
}
