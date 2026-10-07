import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createPaginatedResponse } from "../common/utils/pagination.util";
import { PrismaService } from "../prisma/prisma.service";
import { adminAuditLogSelect } from "../utils/prisma-selects";
import {
  AuditAction,
  AuditEntry,
  AuditLogEntryDto,
  AuditLogPageDto,
  AuditTargetType,
  ListAuditLogQueryDto,
} from "./dto/admin-audit.dto";

const DEFAULT_TAKE = 20;

type AuditRow = Prisma.AdminAuditLogGetPayload<{
  select: typeof adminAuditLogSelect;
}>;

function toDto(row: AuditRow): AuditLogEntryDto {
  return {
    id: row.id,
    action: row.action as AuditAction,
    targetType: row.targetType as AuditTargetType,
    targetId: row.targetId,
    before: (row.before as Record<string, unknown> | null) ?? null,
    after: (row.after as Record<string, unknown> | null) ?? null,
    actorId: row.actor?.id ?? null,
    actorName: row.actor
      ? `${row.actor.firstName} ${row.actor.lastName}`
      : null,
    createdAt: row.createdAt,
  };
}

function toCreateData(
  entry: AuditEntry,
): Prisma.AdminAuditLogUncheckedCreateInput {
  return {
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    before: entry.before as Prisma.InputJsonValue | undefined,
    after: entry.after as Prisma.InputJsonValue | undefined,
  };
}

/** Back-office audit trail: written inside each admin write's transaction. */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Must be called with the transaction client of the audited write. */
  async record(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.adminAuditLog.create({
      data: toCreateData(entry),
      select: { id: true },
    });
  }

  /** Same row, as an operation for an array-form `$transaction([...])`. */
  recordOp(entry: AuditEntry): Prisma.PrismaPromise<{ id: string }> {
    return this.prisma.adminAuditLog.create({
      data: toCreateData(entry),
      select: { id: true },
    });
  }

  async list(query: ListAuditLogQueryDto): Promise<AuditLogPageDto> {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const where: Prisma.AdminAuditLogWhereInput = {
      ...(query.actorId && { actorId: query.actorId }),
      ...(query.targetType && { targetType: query.targetType }),
      ...(query.targetId && { targetId: query.targetId }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.adminAuditLog.count({ where }),
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: adminAuditLogSelect,
      }),
    ]);
    return createPaginatedResponse(rows.map(toDto), total, skip, take);
  }
}
