import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { hashToken } from "../utils/token-hash.util";
import {
  parentalConsentStateSelect,
  parentalConsentTokenTargetSelect,
  userBirthDateSelect,
} from "../utils/prisma-selects";
import {
  effectiveParentalConsentState,
  healthDataAllowed,
  ParentalConsentOutcome,
  parentalConsentRequirement,
  ParentalConsentState,
} from "./parental-consent.policy";

/** What the minor's app shows (GET /parental-consent/me). */
export interface ParentalConsentView {
  state: ParentalConsentState;
  lastOutcome: ParentalConsentOutcome | null;
  parentEmailMasked: string | null;
  requestedAt: Date | null;
  expiresAt: Date | null;
  grantedAt: Date | null;
  revokedAt: Date | null;
}

/** What the parent's page shows for a link (POST /parental-consent/lookup). */
export type ParentalConsentLinkState =
  | "PENDING"
  | "EXPIRED"
  | "GRANTED"
  | "REVOKED";

export interface ParentalConsentLinkView {
  childFirstName: string;
  state: ParentalConsentLinkState;
  expiresAt: Date;
  grantedAt: Date | null;
  revokedAt: Date | null;
}

/** Message of a link that designates nothing usable (unknown or replaced). */
export const PARENTAL_CONSENT_INVALID_LINK =
  "Ce lien est invalide ou a été remplacé par une demande plus récente.";

/** Refusal of the health-data gate, shown as is by the app. */
export const PARENTAL_CONSENT_REQUIRED_MESSAGE =
  "L'accord d'un représentant légal est nécessaire avant de déposer un certificat médical. Renseignez son adresse e-mail depuis votre profil.";

/**
 * Reads of the parental consent (#61): state of an account, state of a link,
 * and the health-data gate used by the licence renewal.
 */
@Injectable()
export class ParentalConsentQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /** Latest request of a user that has not been replaced by a newer one. */
  private latestRecord(userId: string) {
    return this.prisma.parentalConsent.findFirst({
      where: { userId, status: { not: "SUPERSEDED" } },
      orderBy: { requestedAt: "desc" },
      select: parentalConsentStateSelect,
    });
  }

  async getState(
    userId: string,
    now = new Date(),
  ): Promise<ParentalConsentView> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: userBirthDateSelect,
    });
    if (!user) throw new NotFoundException("Utilisateur introuvable");

    const requirement = parentalConsentRequirement(user.birthDate, now);
    const latest =
      requirement === "REQUIRED" ? await this.latestRecord(userId) : null;
    const { state, lastOutcome } = effectiveParentalConsentState(
      requirement,
      latest,
      now,
    );
    return {
      state,
      lastOutcome,
      parentEmailMasked: latest?.parentEmailMasked ?? null,
      requestedAt: latest?.requestedAt ?? null,
      expiresAt: latest?.expiresAt ?? null,
      grantedAt: latest?.grantedAt ?? null,
      revokedAt: latest?.revokedAt ?? null,
    };
  }

  /**
   * Health-data gate: a minor without a confirmed parental consent cannot
   * deposit nor submit a medical certificate (acceptance criterion of #61).
   */
  async assertHealthDataAllowed(userId: string): Promise<void> {
    const { state } = await this.getState(userId);
    if (!healthDataAllowed(state)) {
      throw new ForbiddenException(PARENTAL_CONSENT_REQUIRED_MESSAGE);
    }
  }

  /**
   * The request a link designates. Unknown and replaced links are refused
   * alike: a replaced link must not confirm nor withdraw anything.
   */
  async findByToken(token: string) {
    const record = await this.prisma.parentalConsent.findUnique({
      where: { tokenHash: hashToken(token) },
      select: parentalConsentTokenTargetSelect,
    });
    if (!record || record.status === "SUPERSEDED") {
      throw new BadRequestException(PARENTAL_CONSENT_INVALID_LINK);
    }
    return record;
  }

  async lookup(
    token: string,
    now = new Date(),
  ): Promise<ParentalConsentLinkView> {
    const record = await this.findByToken(token);
    return {
      childFirstName: record.user.firstName,
      state: linkState(record.status, record.expiresAt, now),
      expiresAt: record.expiresAt,
      grantedAt: record.grantedAt,
      revokedAt: record.revokedAt,
    };
  }
}

export function linkState(
  status: string,
  expiresAt: Date,
  now: Date,
): ParentalConsentLinkState {
  switch (status) {
    case "GRANTED":
      return "GRANTED";
    case "REVOKED":
      return "REVOKED";
    case "PENDING":
      return expiresAt.getTime() > now.getTime() ? "PENDING" : "EXPIRED";
    default:
      throw new BadRequestException(PARENTAL_CONSENT_INVALID_LINK);
  }
}
