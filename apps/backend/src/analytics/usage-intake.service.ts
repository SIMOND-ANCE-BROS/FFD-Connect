import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { UsageEventDto } from "./dto/usage-event.dto";
import { USAGE_FUTURE_SKEW_MS, USAGE_PAST_WINDOW_MS } from "./usage.constants";

/** Stores anonymous usage batches. Never reads the request (IP, User-Agent). */
@Injectable()
export class UsageIntakeService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(
    events: UsageEventDto[],
    now: Date = new Date(),
  ): Promise<number> {
    const min = now.getTime() - USAGE_PAST_WINDOW_MS;
    const max = now.getTime() + USAGE_FUTURE_SKEW_MS;
    const times = events.map((e) => Date.parse(e.occurredAt));
    if (times.some((t) => !(t >= min && t <= max))) {
      throw new BadRequestException("occurredAt outside the accepted window");
    }
    const { count } = await this.prisma.usageEvent.createMany({
      data: events.map((e, i) => ({
        installId: e.installId,
        name: e.name,
        screen: e.screen ?? null,
        occurredAt: new Date(times[i]),
        platform: e.platform,
        appVersion: e.appVersion,
        space: e.space,
        competitionId: e.competitionId ?? null,
        durationSec: e.durationSec ?? null,
      })),
    });
    return count;
  }
}
