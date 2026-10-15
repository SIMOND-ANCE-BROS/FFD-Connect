import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createPaginatedResponse } from "../common/utils/pagination.util";
import { PrismaService } from "../prisma/prisma.service";
import { healthDataAccessLogSelect } from "../utils/prisma-selects";
import {
  HealthDataAccessAction,
  HealthDataAccessLogEntryDto,
  HealthDataAccessLogPageDto,
  HealthDataActorRole,
  HealthDataResourceType,
  ListHealthDataAccessLogQueryDto,
} from "./dto/health-data-access-log.dto";

const DEFAULT_TAKE = 20;

type Row = Prisma.HealthDataAccessLogGetPayload<{
  select: typeof healthDataAccessLogSelect;
}>;

function toDto(row: Row): HealthDataAccessLogEntryDto {
  return {
    ...row,
    // Written only from the typed constants (HealthDataAccessEntry).
    actorRole: row.actorRole as HealthDataActorRole,
    action: row.action as HealthDataAccessAction,
    resourceType: row.resourceType as HealthDataResourceType,
  };
}

/**
 * Access journal for health data (#63): reads, for the administrator. Ids
 * only — no name is joined: the subject's identity is looked up separately by
 * whoever has a reason to (the journal answers "who accessed what, when").
 */
@Injectable()
export class HealthDataAccessLogQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListHealthDataAccessLogQueryDto,
  ): Promise<HealthDataAccessLogPageDto> {
    const skip = query.skip ?? 0;
    const take = query.take ?? DEFAULT_TAKE;
    const where: Prisma.HealthDataAccessLogWhereInput = {
      ...(query.subjectUserId && { subjectUserId: query.subjectUserId }),
      ...(query.actorUserId && { actorUserId: query.actorUserId }),
      ...(query.action && { action: query.action }),
    };
    const [total, rows] = await Promise.all([
      this.prisma.healthDataAccessLog.count({ where }),
      this.prisma.healthDataAccessLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
        select: healthDataAccessLogSelect,
      }),
    ]);
    return createPaginatedResponse(rows.map(toDto), total, skip, take);
  }
}
