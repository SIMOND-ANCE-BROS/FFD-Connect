import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as crypto from "crypto";
import { LicenseQrService } from "../../licenses/qr/license-qr.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import {
  competitionPublicResultsSelect,
  idOnlySelect,
  userNameSelect,
  volunteerTokenAuthSelect,
  volunteerTokenIssuedSelect,
} from "../../utils/prisma-selects";
import { hashToken } from "../../utils/token-hash.util";
import { CompetitionResultDto } from "../dto/competition-result.dto";
import {
  CompetitionCacheService,
  resultsCacheKey,
} from "./competition-cache.service";

/**
 * Keys of the free-form `Result.details` (import JSON) published by the
 * public results endpoint: the official ranking as the organiser publishes
 * it, nothing else. Allow-list, so a key a future import adds (licence
 * number, birth date...) is never published by accident (#413).
 */
export const PUBLIC_RESULT_DETAIL_KEYS = [
  "participant",
  "name",
  "club",
  "bib",
  "status",
  "marks",
  "totalParticipants",
] as const;

/**
 * Reduces `details` to the public keys. Always an object: the live results
 * screen reads `details.participant` without a null guard.
 */
export function publicResultDetails(
  details: Prisma.JsonValue,
): Record<string, Prisma.JsonValue> {
  const kept: Record<string, Prisma.JsonValue> = {};
  if (details && typeof details === "object" && !Array.isArray(details)) {
    for (const key of PUBLIC_RESULT_DETAIL_KEYS) {
      const value = details[key];
      if (value !== undefined && value !== null) kept[key] = value;
    }
  }
  return kept;
}

@Injectable()
export class CompetitionResultsService {
  private readonly logger = new Logger(CompetitionResultsService.name);
  private readonly CACHE_TTL = 3600; // 1 heure

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly cacheService: CompetitionCacheService,
    private readonly licenseQrService: LicenseQrService,
  ) {}

  /**
   * Public results of a competition (no auth). Each row is built field by
   * field from `publicResultSelect`: never `userId` (#413), even if the
   * select grows. Cached under a versioned key (`resultsCacheKey`).
   */
  async getResults(competitionId: string): Promise<CompetitionResultDto[]> {
    const cacheKey = resultsCacheKey(competitionId);

    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as CompetitionResultDto[];
      } catch {
        this.logger.warn(
          `Corrupted cache entry for key "${cacheKey}", evicting`,
        );
        await this.redisService.delete(cacheKey);
      }
    }

    const competition = await this.prisma.competition.findUnique({
      where: { id: competitionId },
      select: competitionPublicResultsSelect,
    });

    if (!competition) {
      throw new NotFoundException("Compétition non trouvée");
    }

    const results: CompetitionResultDto[] = competition.events.flatMap(
      (event) =>
        event.results.map((res) => ({
          id: res.id,
          eventId: res.eventId,
          round: res.round,
          ranking: res.ranking,
          details: publicResultDetails(res.details),
          event: {
            id: event.id,
            category: event.category,
            ageGroup: event.ageGroup,
          },
        })),
    );

    await this.redisService.set(
      cacheKey,
      JSON.stringify(results),
      this.CACHE_TTL,
    );

    return results;
  }

  async getEventRegistrations(eventId: string) {
    const registrations = await this.prisma.registration.findMany({
      where: { eventId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            clubName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    return registrations;
  }

  async getUserRegistrations(userId: string) {
    return this.prisma.registration.findMany({
      where: { userId },
      include: {
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
      take: 500,
    });
  }

  async checkIn(competitionId: string, qrData: string) {
    // Signature check first (#168): in `enforce` mode an unsigned, forged or
    // expired QR never reaches the lookup; in `warn` mode it goes through but
    // the response carries a warning for the staff screen.
    const qrCheck = this.licenseQrService.verify(qrData);
    if (!qrCheck.accepted) {
      this.logger.warn(
        `Check-in refused for competition ${competitionId}: QR ${qrCheck.status}`,
      );
      throw new BadRequestException(qrCheck.warning ?? "QR Code non vérifié");
    }
    if (qrCheck.warning) {
      this.logger.warn(
        `Check-in with unverified QR for competition ${competitionId}: ${qrCheck.status}`,
      );
    }
    const qrVerification = {
      mode: qrCheck.mode,
      status: qrCheck.status,
      warning: qrCheck.warning,
    };
    const identifier = qrCheck.identifier;

    // A verified QR carries a license NUMBER: never resolve it as a user id.
    let user = qrCheck.signedLicenseNumber
      ? null
      : await this.prisma.user.findUnique({
          where: { id: identifier },
          select: userNameSelect,
        });
    // Le QR licence de l'app encode le NUMÉRO de licence (cf. LicenseCard :
    // qrData.id = licenseNumber), pas l'id utilisateur. Si la résolution directe
    // par id échoue, on retombe sur une résolution par numéro de licence.
    if (!user) {
      const license = await this.prisma.license.findUnique({
        where: { number: identifier },
        select: { user: { select: userNameSelect } },
      });
      user = license?.user ?? null;
    }
    if (!user) {
      throw new NotFoundException("Utilisateur introuvable avec ce QR Code");
    }

    const registrations = await this.prisma.registration.findMany({
      where: {
        userId: user.id,
        event: { competitionId },
        status: "CONFIRMED",
      },
      select: {
        id: true,
        eventId: true,
        bibNumber: true,
        feePaid: true,
        checkedIn: true,
        partnerName: true,
        event: { select: { category: true } },
      },
    });

    if (registrations.length === 0) {
      throw new NotFoundException(
        "Aucune inscription confirmée pour cette compétition",
      );
    }

    const checkInResults = [];
    const regsToUpdate: string[] = [];
    const now = new Date();

    for (const reg of registrations) {
      if (!reg.feePaid) {
        checkInResults.push({
          event: reg.event.category,
          status: "ERROR",
          message: "Droits non payés",
        });
        continue;
      }

      if (reg.checkedIn) {
        checkInResults.push({
          event: reg.event.category,
          status: "ALREADY_CHECKED_IN",
          bibNumber: reg.bibNumber,
          partner: reg.partnerName,
        });
        continue;
      }

      // Collect IDs for batch update
      regsToUpdate.push(reg.id);
      checkInResults.push({
        event: reg.event.category,
        status: "SUCCESS",
        bibNumber: reg.bibNumber,
        partner: reg.partnerName,
      });
    }

    // Perform batch update if there are registrations to check in
    if (regsToUpdate.length > 0) {
      await this.prisma.registration.updateMany({
        where: { id: { in: regsToUpdate } },
        data: { checkedIn: true, checkInTime: now },
      });
    }

    // Invalidate competition cache for the user after successful check-in
    await this.cacheService.invalidateCompetition(competitionId, user.id);
    this.logger.log(`Cache invalidated for user ${user.id} after check-in`);

    return {
      user: { firstName: user.firstName, lastName: user.lastName },
      registrations: checkInResults,
      qrVerification,
    };
  }

  async generateVolunteerToken(competitionId: string, name?: string) {
    const competition = await this.prisma.competition.findUnique({
      where: { id: competitionId },
      select: idOnlySelect,
    });
    if (!competition) {
      throw new NotFoundException("Compétition non trouvée");
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // Token valid for 24h

    // Only the SHA-256 hash is persisted; the plain token is returned once,
    // here, and cannot be read back afterwards.
    const volunteerToken = await this.prisma.volunteerToken.create({
      data: {
        token: hashToken(token),
        competitionId,
        expiresAt,
        name: name ?? "Bénévole",
      },
      select: volunteerTokenIssuedSelect,
    });

    return {
      ...volunteerToken,
      token,
      accessUrl: `https://ffd-connect.fr/volunteer/checkin?token=${token}&id=${competitionId}`,
    };
  }

  async checkInAsVolunteer(
    competitionId: string,
    token: string,
    qrData: string,
  ) {
    const volunteerToken = await this.prisma.volunteerToken.findUnique({
      where: { token: hashToken(token) },
      select: volunteerTokenAuthSelect,
    });

    if (
      volunteerToken?.competitionId !== competitionId ||
      volunteerToken.expiresAt < new Date()
    ) {
      throw new UnauthorizedException("Lien d'accès invalide ou expiré");
    }

    this.logger.log(
      `Volunteer ${volunteerToken.name} performing check-in (link ${volunteerToken.id})`,
    );
    return this.checkIn(competitionId, qrData);
  }
}
