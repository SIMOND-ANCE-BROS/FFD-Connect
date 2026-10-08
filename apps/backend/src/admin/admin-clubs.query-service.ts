import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, UserRole } from "@prisma/client";
import { createPaginatedResponse } from "../common/utils/pagination.util";
import { PrismaService } from "../prisma/prisma.service";
import {
  adminClubListSelect,
  adminClubMemberSelect,
  adminClubOptionSelect,
} from "../utils/prisma-selects";
import { clubUsage } from "./admin-club-usage";
import {
  AdminClubDetailDto,
  AdminClubsPageDto,
  ListAdminClubsQueryDto,
} from "./dto/admin-clubs.dto";
import { AdminClubOptionDto } from "./dto/admin-reference.dto";

const DEFAULT_TAKE = 50;
/** Clubs are a small, federation-wide list; 1000 is a safety bound. */
const MAX_CLUBS = 1000;
const MAX_MEMBERS = 200;

interface MemberCounts {
  memberCount: number;
  clubAccountCount: number;
}

/** Back-office reads of clubs (list, select options, detail). */
@Injectable()
export class AdminClubsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ListAdminClubsQueryDto): Promise<AdminClubsPageDto> {
    const skip = q.skip ?? 0;
    const take = q.take ?? DEFAULT_TAKE;
    const search = q.search?.trim();
    const where: Prisma.ClubWhereInput = {
      ...(search && { name: { contains: search, mode: "insensitive" } }),
      ...(q.status && {
        disabledAt: q.status === "active" ? null : { not: null },
      }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.club.count({ where }),
      this.prisma.club.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip,
        take,
        select: adminClubListSelect,
      }),
    ]);
    const ids = rows.map((r) => r.id);
    const [counts, configured] = await Promise.all([
      this.memberCounts(ids),
      this.helloAssoConfigured(ids),
    ]);
    return createPaginatedResponse(
      rows.map((r) => ({
        ...r,
        ...(counts.get(r.id) ?? { memberCount: 0, clubAccountCount: 0 }),
        helloAssoConfigured: configured.has(r.id),
      })),
      total,
      skip,
      take,
    );
  }

  /** Active clubs for selects, plus `includeId` (the current value). */
  options(includeId?: string): Promise<AdminClubOptionDto[]> {
    return this.prisma.club.findMany({
      where: includeId
        ? { OR: [{ disabledAt: null }, { id: includeId }] }
        : { disabledAt: null },
      orderBy: { name: "asc" },
      take: MAX_CLUBS,
      select: adminClubOptionSelect,
    });
  }

  async detail(id: string): Promise<AdminClubDetailDto> {
    const club = await this.prisma.club.findUnique({
      where: { id },
      select: adminClubListSelect,
    });
    if (!club) throw new NotFoundException("Club introuvable");
    const usage = await clubUsage(this.prisma, club);
    const configured = await this.helloAssoConfigured([id]);
    const members = await this.prisma.user.findMany({
      where: { clubId: id },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
      take: MAX_MEMBERS,
      select: adminClubMemberSelect,
    });
    return {
      ...club,
      ...usage,
      helloAssoConfigured: configured.has(id),
      members,
    };
  }

  /** One grouped query for a page of clubs (members vs CLUB accounts). */
  private async memberCounts(
    ids: string[],
  ): Promise<Map<string, MemberCounts>> {
    const counts = new Map<string, MemberCounts>();
    if (!ids.length) return counts;
    const groups = await this.prisma.user.groupBy({
      by: ["clubId", "role"],
      where: { clubId: { in: ids } },
      _count: { _all: true },
    });
    for (const g of groups) {
      if (!g.clubId) continue;
      const c = counts.get(g.clubId) ?? { memberCount: 0, clubAccountCount: 0 };
      if (g.role === UserRole.CLUB) c.clubAccountCount += g._count._all;
      else c.memberCount += g._count._all;
      counts.set(g.clubId, c);
    }
    return counts;
  }

  /**
   * Filtered in the database so the HelloAsso secret is never read. `not: ""`
   * also excludes NULL (SQL `<> ''` is not true for NULL).
   */
  private async helloAssoConfigured(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.prisma.club.findMany({
      where: {
        id: { in: ids },
        helloAssoClientId: { not: "" },
        helloAssoClientSecret: { not: "" },
        helloAssoOrgSlug: { not: "" },
      },
      select: { id: true },
      take: ids.length,
    });
    return new Set(rows.map((r) => r.id));
  }
}
