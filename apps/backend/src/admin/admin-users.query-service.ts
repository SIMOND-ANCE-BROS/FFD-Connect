import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { rolesOf, withRole } from "../auth/roles";
import { createPaginatedResponse } from "../common/utils/pagination.util";
import { PrismaService } from "../prisma/prisma.service";
import { isCreatedByAdmin } from "./admin-audit.util";
import {
  adminUserDetailSelect,
  adminUserListSelect,
} from "../utils/prisma-selects";
import {
  AdminUserDetailDto,
  AdminUserListItemDto,
  AdminUsersPageDto,
  LicenseStatus,
  ListAdminUsersQueryDto,
} from "./dto/admin-users.dto";

const DEFAULT_TAKE = 50;
const DAY_MS = 86_400_000;

type ListRow = Prisma.UserGetPayload<{ select: typeof adminUserListSelect }>;

export function licenseStatus(
  license: { validUntil: Date } | null,
  now: Date,
): LicenseStatus | null {
  if (!license) return null;
  return license.validUntil.getTime() >= now.getTime() ? "ACTIVE" : "EXPIRED";
}

function toListItem(row: ListRow, now: Date): AdminUserListItemDto {
  const { license, ...rest } = row;
  return {
    ...rest,
    roles: rolesOf(rest),
    licenseStatus: licenseStatus(license, now),
  };
}

/** Back-office reads of users (list + detail). */
@Injectable()
export class AdminUsersQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(q: ListAdminUsersQueryDto): Promise<AdminUsersPageDto> {
    const skip = q.skip ?? 0;
    const take = q.take ?? DEFAULT_TAKE;
    const search = q.search?.trim();
    const where: Prisma.UserWhereInput = {
      ...(search && {
        OR: [
          { email: { contains: search, mode: "insensitive" } },
          { firstName: { contains: search, mode: "insensitive" } },
          { lastName: { contains: search, mode: "insensitive" } },
        ],
      }),
      // AND, never next to the search OR: withRole is itself an OR.
      ...(q.role && { AND: [withRole(q.role)] }),
      ...(q.clubId && { clubId: q.clubId }),
      ...(q.category && { category: q.category }),
      ...(q.status && {
        disabledAt: q.status === "active" ? null : { not: null },
      }),
      ...((q.createdFrom || q.createdTo) && {
        createdAt: {
          ...(q.createdFrom && { gte: new Date(q.createdFrom) }),
          // createdTo is inclusive: strictly before the next day.
          ...(q.createdTo && {
            lt: new Date(new Date(q.createdTo).getTime() + DAY_MS),
          }),
        },
      }),
    };

    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        // id breaks createdAt ties so offset pages never overlap or skip rows.
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
        select: adminUserListSelect,
      }),
    ]);
    const now = new Date();
    return createPaginatedResponse(
      rows.map((r) => toListItem(r, now)),
      total,
      skip,
      take,
    );
  }

  async detail(id: string): Promise<AdminUserDetailDto> {
    const row = await this.prisma.user.findUnique({
      where: { id },
      select: adminUserDetailSelect,
    });
    if (!row) throw new NotFoundException("Utilisateur introuvable");
    const { license, club, ...rest } = row;
    return {
      ...rest,
      // Stored roles (no club status): a disabled club still shows its extra CLUB.
      roles: rolesOf(rest),
      createdByAdmin: await isCreatedByAdmin(this.prisma, id),
      clubDisabledAt: club?.disabledAt ?? null,
      licenseStatus: licenseStatus(license, new Date()),
      licenseNumber: license?.number ?? null,
      licenseValidUntil: license?.validUntil ?? null,
    };
  }
}
