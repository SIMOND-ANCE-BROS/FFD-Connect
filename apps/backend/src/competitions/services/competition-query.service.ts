import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, RegistrationStatus, UserRole } from "@prisma/client";
import { PaginationParamsDto } from "../../common/dto/pagination-params.dto";
import { createPaginatedResponse } from "../../common/utils/pagination.util";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import {
  enrichCompetitionsForUser,
  mapEventsWithEligibility,
} from "./competition-query.utils";

/** Champs de base récupérés pour toute compétition — source de vérité unique. */
export const COMPETITION_BASE_SELECT = {
  id: true,
  ffdId: true,
  title: true,
  date: true,
  location: true,
  address: true,
  zipCode: true,
  city: true,
  latitude: true,
  longitude: true,
  description: true,
  eventsDescription: true,
  programUrl: true,
  endDate: true,
  type: true,
  competitionType: true,
  majorSubType: true,
  organizer: true,
  circularUrl: true,
  registrationUrl: true,
  ticketingUrl: true,
  layout: true,
  imageUrl: true,
  registrationDeadline: true,
  status: true,
  delayMinutes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CompetitionSelect;

const EVENT_BASE_SELECT = {
  id: true,
  category: true,
  ageGroup: true,
  eventType: true,
  level: true,
  eventKind: true,
} as const;

const CACHE_TTL = 300; // 5 minutes
const CACHE_PREFIX = "competitions:";

@Injectable()
export class CompetitionQueryService {
  private readonly logger = new Logger(CompetitionQueryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async findAll(
    userId?: string,
    pagination: PaginationParamsDto = new PaginationParamsDto(),
  ) {
    const { skip, take } = pagination;
    const cacheKey = `${CACHE_PREFIX}all:${userId ?? "public"}:${skip}:${take}`;

    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      try {
        this.logger.debug(`Cache hit for competitions list: ${cacheKey}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return JSON.parse(cached);
      } catch {
        this.logger.warn(
          `Corrupted cache entry for key "${cacheKey}", evicting`,
        );
        await this.redisService.delete(cacheKey);
      }
    }

    const [total, competitions] = await Promise.all([
      this.prisma.competition.count(),
      this.prisma.competition.findMany({
        orderBy: { date: "asc" },
        skip,
        take,
        select: {
          ...COMPETITION_BASE_SELECT,
          events: {
            select: {
              ...EVENT_BASE_SELECT,
              registrations: userId
                ? {
                    where: {
                      userId,
                      status: {
                        in: [
                          RegistrationStatus.PENDING,
                          RegistrationStatus.CONFIRMED,
                        ],
                      },
                    },
                    select: {
                      id: true,
                      userId: true,
                      partnerName: true,
                      status: true,
                      bibNumber: true,
                      checkedIn: true,
                      checkInTime: true,
                      feePaid: true,
                      createdAt: true,
                      coupleAgeGroup: true,
                      coupleDisciplineLatin: true,
                      coupleDisciplineStandard: true,
                    },
                  }
                : false,
            },
          },
        },
      }),
    ]);

    let result = competitions;

    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          category: true,
          ageGroup: true,
          role: true,
          clubId: true,
          clubName: true,
        },
      });
      result = enrichCompetitionsForUser(competitions, user);
      if (
        user?.role === "CLUB" &&
        (user.clubId || (user.clubName && typeof user.clubName === "string"))
      ) {
        result = await this.enrichCompetitionsForOrganizer(result, {
          clubId: user.clubId,
          clubName: user.clubName ?? undefined,
        });
      }
    }

    const paginatedResult = createPaginatedResponse(
      result,
      total,
      skip ?? 0,
      take ?? 10,
    );

    await this.redisService.set(
      cacheKey,
      JSON.stringify(paginatedResult),
      CACHE_TTL,
    );
    this.logger.debug(`Cached paginated competitions list: ${cacheKey}`);

    return paginatedResult;
  }

  async findOne(id: string) {
    const cacheKey = `${CACHE_PREFIX}one:${id}`;

    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      try {
        this.logger.debug(`Cache hit for competition: ${id}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return JSON.parse(cached);
      } catch {
        this.logger.warn(
          `Corrupted cache entry for key "${cacheKey}", evicting`,
        );
        await this.redisService.delete(cacheKey);
      }
    }

    const competition = await this.prisma.competition.findUnique({
      where: { id },
      select: {
        ...COMPETITION_BASE_SELECT,
        events: { select: EVENT_BASE_SELECT },
        schedule: {
          select: {
            id: true,
            startTime: true,
            title: true,
            type: true,
            eventId: true,
          },
          orderBy: { startTime: "asc" },
        },
      },
    });

    if (!competition) throw new NotFoundException("Competition not found");

    await this.redisService.set(
      cacheKey,
      JSON.stringify(competition),
      CACHE_TTL,
    );
    this.logger.debug(`Cached competition: ${id}`);

    return competition;
  }

  async findOneForUser(id: string, userId: string) {
    const competition = await this.prisma.competition.findUnique({
      where: { id },
      select: {
        ...COMPETITION_BASE_SELECT,
        events: { select: EVENT_BASE_SELECT },
        schedule: {
          select: {
            id: true,
            startTime: true,
            title: true,
            type: true,
            eventId: true,
          },
          orderBy: { startTime: "asc" },
        },
      },
    });

    if (!competition) throw new NotFoundException("Competition not found");

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ageGroup: true, category: true },
    });

    const registrantAgeGroup = user?.ageGroup?.trim() ?? null;
    const registrantCategory = user?.category?.trim() ?? null;

    const eventsWithEligibility = mapEventsWithEligibility(
      competition.events,
      competition,
      registrantAgeGroup,
      registrantCategory,
    );

    return { ...competition, events: eventsWithEligibility };
  }

  async findActiveCompetition() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.prisma.competition.findFirst({
      where: { date: { gte: today, lt: tomorrow } },
      select: {
        ...COMPETITION_BASE_SELECT,
        events: { select: EVENT_BASE_SELECT },
      },
    });
  }

  private async enrichCompetitionsForOrganizer<
    T extends { id: string; organizer?: string | null },
  >(
    competitions: T[],
    club: { clubId?: string | null; clubName?: string },
  ): Promise<
    (T & { isOrganizedByMyClub: boolean; clubMembersRegisteredCount: number })[]
  > {
    const sameClubCondition = club.clubId
      ? { clubId: club.clubId }
      : club.clubName?.trim()
        ? {
            clubName: {
              equals: club.clubName.trim(),
              mode: "insensitive" as const,
            },
          }
        : null;

    if (!sameClubCondition) {
      return competitions.map((comp) => ({
        ...comp,
        isOrganizedByMyClub: false,
        clubMembersRegisteredCount: 0,
      }));
    }

    const ids = competitions.map((c) => c.id);
    const clubRegistrations = await this.prisma.registration.findMany({
      where: {
        status: {
          in: [RegistrationStatus.PENDING, RegistrationStatus.CONFIRMED],
        },
        user: sameClubCondition,
        event: { competitionId: { in: ids } },
      },
      select: { event: { select: { competitionId: true } } },
    });

    const countByCompetitionId = clubRegistrations.reduce<
      Record<string, number>
    >((acc, r) => {
      const cid = r.event.competitionId;
      acc[cid] = (acc[cid] ?? 0) + 1;
      return acc;
    }, {});

    const clubNameNorm = (club.clubName ?? "").trim().toLowerCase();
    return competitions.map((comp) => ({
      ...comp,
      isOrganizedByMyClub:
        (comp.organizer?.trim().toLowerCase() ?? "") === clubNameNorm,
      clubMembersRegisteredCount: countByCompetitionId[comp.id] ?? 0,
    }));
  }

  async getPendingRegistrationsForClub(organizerUserId: string) {
    const organizer = await this.prisma.user.findUnique({
      where: { id: organizerUserId },
      select: { role: true, clubId: true, clubName: true },
    });
    if (organizer?.role !== UserRole.CLUB) return [];

    const sameClubCondition = organizer.clubId
      ? { clubId: organizer.clubId }
      : organizer.clubName?.trim()
        ? {
            clubName: {
              equals: organizer.clubName.trim(),
              mode: "insensitive" as const,
            },
          }
        : null;
    if (!sameClubCondition) return [];

    const pending = await this.prisma.registration.findMany({
      where: { status: RegistrationStatus.PENDING, user: sameClubCondition },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            clubName: true,
          },
        },
        event: {
          select: {
            id: true,
            category: true,
            ageGroup: true,
            eventType: true,
            competitionId: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const competitionIds = [
      ...new Set(pending.map((r) => r.event.competitionId)),
    ] as string[];
    const competitions =
      competitionIds.length > 0
        ? await this.prisma.competition.findMany({
            where: { id: { in: competitionIds } },
            select: { id: true, title: true, date: true },
          })
        : [];

    const compMap = new Map(competitions.map((c) => [c.id, c]));
    return pending.map((r) => ({
      ...r,
      competition: compMap.get(r.event.competitionId) ?? null,
    }));
  }
}
