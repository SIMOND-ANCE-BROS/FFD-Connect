import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  idOnlySelect,
  inactiveAccountWarningSelect,
} from "../utils/prisma-selects";
import { deletionDueWhere, warningDueWhere } from "./inactive-account.rules";

/** An account due for the inactivity warning (#991). */
export type InactiveAccountWarningTarget = Prisma.UserGetPayload<{
  select: typeof inactiveAccountWarningSelect;
}>;

/** Keyset pagination on the id: a page never re-reads a skipped account. */
function after(
  where: Prisma.UserWhereInput,
  afterId: string | undefined,
): Prisma.UserWhereInput {
  return afterId ? { AND: [where, { id: { gt: afterId } }] } : where;
}

/**
 * Reads of the inactive-account purge (#991). Every list is bounded by
 * `take` and paginated by id, so an account that keeps failing never starves
 * the others.
 */
@Injectable()
export class InactiveAccountsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  findWarningDue(
    now: Date,
    afterId: string | undefined,
    take: number,
  ): Promise<InactiveAccountWarningTarget[]> {
    return this.prisma.user.findMany({
      where: after(
        warningDueWhere(now, this.prisma.user.fields.lastLoginAt),
        afterId,
      ),
      select: inactiveAccountWarningSelect,
      orderBy: { id: "asc" },
      take,
    });
  }

  async findDeletionDueIds(
    now: Date,
    afterId: string | undefined,
    take: number,
  ): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: after(
        deletionDueWhere(now, this.prisma.user.fields.lastLoginAt),
        afterId,
      ),
      select: idOnlySelect,
      orderBy: { id: "asc" },
      take,
    });
    return rows.map((r) => r.id);
  }

  /** Re-check right before a deletion: a login meanwhile cancels it. */
  async isDeletionDue(userId: string, now: Date): Promise<boolean> {
    const row = await this.prisma.user.findFirst({
      where: {
        AND: [
          { id: userId },
          deletionDueWhere(now, this.prisma.user.fields.lastLoginAt),
        ],
      },
      select: idOnlySelect,
    });
    return row !== null;
  }

  /** Dry run: how many accounts a real pass would warn / delete. */
  async countDue(now: Date): Promise<{ warning: number; deletion: number }> {
    const ref = this.prisma.user.fields.lastLoginAt;
    const [warning, deletion] = await Promise.all([
      this.prisma.user.count({ where: warningDueWhere(now, ref) }),
      this.prisma.user.count({ where: deletionDueWhere(now, ref) }),
    ]);
    return { warning, deletion };
  }
}
