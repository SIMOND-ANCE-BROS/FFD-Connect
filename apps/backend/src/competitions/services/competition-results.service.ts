import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as crypto from "crypto";
import { Prisma } from "@prisma/client";
import { parseEntryQr } from "../../licenses/qr/entry-qr";
import {
  parisEndOfDay,
  parisStartOfDay,
  toLicenseQrExpiry,
} from "../../licenses/qr/license-qr";
import {
  LicenseQrCheck,
  LicenseQrService,
  STALE_LICENSE_QR_MESSAGE,
} from "../../licenses/qr/license-qr.service";
import { PrismaService } from "../../prisma/prisma.service";
import { RedisService } from "../../redis/redis.service";
import {
  checkInLicenseSelect,
  competitionCheckInPolicySelect,
  competitionPublicResultsSelect,
  idOnlySelect,
  retiredLicenseNumberSelect,
  userNameSelect,
  volunteerTokenAuthSelect,
  volunteerTokenIssuedSelect,
} from "../../utils/prisma-selects";
import { hashToken } from "../../utils/token-hash.util";
import { CompetitionResultDto } from "../dto/competition-result.dto";
import { toPublicResult } from "../public-result";
import {
  CompetitionCacheService,
  resultsCacheKey,
} from "./competition-cache.service";

type CheckInUser = Prisma.UserGetPayload<{ select: typeof userNameSelect }>;
type CheckInCompetition = Prisma.CompetitionGetPayload<{
  select: typeof competitionCheckInPolicySelect;
}>;

/**
 * A check-in scanned offline (#24) is replayed later with the instant of the
 * scan it CLAIMS (`scannedAt`): the rotating QR (~90 s) is verified as of
 * that instant. Because the instant comes from the client, it is bounded so
 * a captured token cannot be "backdated" into validity:
 * - rotating QR (v3) only, and it must verify as VALID at that instant in
 *   every mode (no `warn` leniency);
 * - in the past (2 min of clock drift), at most 12 h old — the length of a
 *   token batch — and within the competition's day(s), Europe/Paris;
 * - single use per (licence, competition): a licence already checked in is
 *   never checked in again (ALREADY_CHECKED_IN);
 * - the claimed instant is stored apart (`checkInClaimedScanAt`); the
 *   authoritative `checkInTime` is the server clock at receipt.
 */
export const CHECK_IN_SCANNED_AT_MAX_AGE_MS = 12 * 3600 * 1000;
/** Clock drift tolerated between the scanner and the server. */
export const CHECK_IN_SCANNED_AT_MAX_SKEW_MS = 2 * 60 * 1000;

export const INVALID_SCANNED_AT_MESSAGE =
  "Heure de scan invalide : un scan hors ligne doit dater du jour de la compétition et être synchronisé dans les 12 h";
export const SCANNED_AT_ROTATING_ONLY_MESSAGE =
  "Heure de scan refusée : seul un QR d'entrée tournant valide peut être synchronisé après un scan hors ligne";
/**
 * Competition requiring the rotating entry QR (#668): a static QR (v1/v2 —
 * Wallet pass, older app, snapshot) is refused. Same wording as the offline
 * scanner (`apps/client/.../offlineCheckin.ts`).
 */
export const STATIC_QR_REFUSED_MESSAGE =
  "QR statique refusé : présentez le QR tournant de l'E-Licence";

interface ScanInstant {
  /** Instant the QR is verified at. */
  verifyAt: Date;
  /** Client-claimed scan instant of an offline replay, null online. */
  claimedAt: Date | null;
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
          ...toPublicResult(res),
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

  async checkIn(competitionId: string, qrData: string, scannedAt?: string) {
    const competition = await this.prisma.competition.findUnique({
      where: { id: competitionId },
      select: competitionCheckInPolicySelect,
    });
    if (!competition) {
      throw new NotFoundException("Compétition non trouvée");
    }
    const isRotatingQr = parseEntryQr(qrData).kind === "entry";
    const scan = this.resolveScanInstant(
      competitionId,
      competition,
      isRotatingQr,
      scannedAt,
    );
    // Rotating QR mandatory for this competition (#668): a static QR is
    // refused before any lookup, in every signature mode — a screenshot of
    // it would otherwise stay valid all season.
    if (competition.requireRotatingQr && !isRotatingQr) {
      this.logger.warn(
        `Check-in refused for competition ${competitionId}: static QR while the rotating QR is mandatory`,
      );
      throw new BadRequestException(STATIC_QR_REFUSED_MESSAGE);
    }
    // Signature check first (#168): in `enforce` mode an unsigned, forged or
    // expired QR never reaches the lookup; in `warn` mode it goes through but
    // the response carries a warning for the staff screen.
    const qrCheck = this.licenseQrService.verify(qrData, scan.verifyAt);
    if (scan.claimedAt && qrCheck.status !== "VALID") {
      // A backdated replay never rides on `warn` leniency (nor on `off`).
      this.logger.warn(
        `Offline check-in replay refused for competition ${competitionId}: QR ${qrCheck.status} at the claimed scan time`,
      );
      throw new BadRequestException(SCANNED_AT_ROTATING_ONLY_MESSAGE);
    }
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
    const { user, check } = await this.resolveCheckInUser(
      competitionId,
      qrCheck,
    );
    const qrVerification = {
      mode: check.mode,
      status: check.status,
      warning: check.warning,
    };
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

    // Authoritative time: the server clock at receipt, never the claim.
    const now = new Date();
    const checkInResults = [];

    for (const reg of registrations) {
      if (!reg.feePaid) {
        checkInResults.push({
          event: reg.event.category,
          status: "ERROR",
          message: "Droits non payés",
        });
        continue;
      }

      // One conditional update per registration (a licence has a handful at
      // most): `checkedIn: false` in the filter makes the check-in single use,
      // and the row count tells a race lost to a concurrent scan or replay
      // (count 0 ⇒ ALREADY_CHECKED_IN), never a false SUCCESS.
      const claimed = reg.checkedIn
        ? 0
        : (
            await this.prisma.registration.updateMany({
              where: { id: reg.id, checkedIn: false },
              data: {
                checkedIn: true,
                checkInTime: now,
                checkInClaimedScanAt: scan.claimedAt,
              },
            })
          ).count;
      checkInResults.push({
        event: reg.event.category,
        status: claimed === 1 ? "SUCCESS" : "ALREADY_CHECKED_IN",
        bibNumber: reg.bibNumber,
        partner: reg.partnerName,
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

  /**
   * Instant the QR is verified at: the server clock, or — for an offline
   * scan replayed later (#24) — the claimed `scannedAt`, within the bounds
   * documented on CHECK_IN_SCANNED_AT_MAX_AGE_MS.
   */
  private resolveScanInstant(
    competitionId: string,
    competition: CheckInCompetition,
    isRotatingQr: boolean,
    scannedAt?: string,
  ): ScanInstant {
    const now = new Date();
    if (scannedAt === undefined) return { verifyAt: now, claimedAt: null };
    // Static QRs (v1/v2, Wallet) are valid all day: a claimed time would only
    // ever widen what they already allow. Only a rotating QR is replayable.
    if (!isRotatingQr) {
      throw new BadRequestException(SCANNED_AT_ROTATING_ONLY_MESSAGE);
    }
    const instant = new Date(scannedAt);
    const age = now.getTime() - instant.getTime();
    if (
      Number.isNaN(instant.getTime()) ||
      age < -CHECK_IN_SCANNED_AT_MAX_SKEW_MS ||
      age > CHECK_IN_SCANNED_AT_MAX_AGE_MS
    ) {
      throw new BadRequestException(INVALID_SCANNED_AT_MESSAGE);
    }
    const claimedAt = age < 0 ? now : instant;
    const firstDay = parisStartOfDay(toLicenseQrExpiry(competition.date));
    const lastDay = parisEndOfDay(
      toLicenseQrExpiry(competition.endDate ?? competition.date),
    );
    if (claimedAt < firstDay || claimedAt >= lastDay) {
      throw new BadRequestException(INVALID_SCANNED_AT_MESSAGE);
    }
    this.logger.log(
      `Offline check-in replayed for competition ${competitionId} (claimed scan ${Math.round(age / 1000)} s before receipt)`,
    );
    return { verifyAt: claimedAt, claimedAt };
  }

  /**
   * Who the scanned QR designates (#466).
   *
   * - Verified v2 QR: bound to a licence id. The licence holding the number
   *   must be that licence; otherwise the number was changed since the QR was
   *   issued ⇒ refused in `enforce`, and in `warn` the licence the QR was
   *   issued for is checked in, with a warning — never the current holder of
   *   the number.
   * - Anything else (v1 signed, legacy unsigned, raw id): bound to the number
   *   alone. When QR verification is on, a number retired by a rename is
   *   refused in every mode: it may now belong to someone else.
   */
  private async resolveCheckInUser(
    competitionId: string,
    qrCheck: LicenseQrCheck,
  ): Promise<{ user: CheckInUser | null; check: LicenseQrCheck }> {
    const identifier = qrCheck.identifier;

    if (qrCheck.licenseId) {
      const license = await this.prisma.license.findUnique({
        where: { number: identifier },
        select: checkInLicenseSelect,
      });
      if (license?.id === qrCheck.licenseId) {
        return { user: license.user, check: qrCheck };
      }
      const mismatch = this.licenseQrService.licenseMismatch(qrCheck);
      this.logger.warn(
        `Check-in ${mismatch.accepted ? "flagged" : "refused"} for competition ${competitionId}: QR ${mismatch.status}`,
      );
      if (!mismatch.accepted) {
        throw new BadRequestException(STALE_LICENSE_QR_MESSAGE);
      }
      const issuedFor = await this.prisma.license.findUnique({
        where: { id: qrCheck.licenseId },
        select: checkInLicenseSelect,
      });
      return { user: issuedFor?.user ?? null, check: mismatch };
    }

    // A verified QR carries a license NUMBER: never resolve it as a user id.
    const user = qrCheck.signedLicenseNumber
      ? null
      : await this.prisma.user.findUnique({
          where: { id: identifier },
          select: userNameSelect,
        });
    if (user) return { user, check: qrCheck };

    // Le QR licence de l'app encode le NUMÉRO de licence (cf. LicenseCard :
    // qrData.id = licenseNumber), pas l'id utilisateur. Si la résolution directe
    // par id échoue, on retombe sur une résolution par numéro de licence.
    const license = await this.prisma.license.findUnique({
      where: { number: identifier },
      select: checkInLicenseSelect,
    });
    if (!license?.user) return { user: null, check: qrCheck };

    if (qrCheck.mode !== "off") {
      const retired = await this.prisma.retiredLicenseNumber.findUnique({
        where: { number: identifier },
        select: retiredLicenseNumberSelect,
      });
      if (retired) {
        this.logger.warn(
          `Check-in refused for competition ${competitionId}: number-only QR for a retired licence number`,
        );
        throw new BadRequestException(STALE_LICENSE_QR_MESSAGE);
      }
    }
    return { user: license.user, check: qrCheck };
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
    scannedAt?: string,
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

    // The link id only: its name is free text, often a person's (RGPD, #529).
    this.logger.log(`Volunteer link ${volunteerToken.id} performing check-in`);
    return this.checkIn(competitionId, qrData, scannedAt);
  }
}
