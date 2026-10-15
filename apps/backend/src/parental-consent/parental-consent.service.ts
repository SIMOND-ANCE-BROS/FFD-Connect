import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  LicenseRenewalDocumentType,
  LicenseRenewalStatus,
  Prisma,
} from "@prisma/client";
import * as crypto from "crypto";
import { normalizeEmail } from "../auth/email-identity";
import { PrismaService } from "../prisma/prisma.service";
import { maskEmail } from "../utils/pii.utils";
import {
  idOnlySelect,
  parentalConsentSubjectSelect,
} from "../utils/prisma-selects";
import { hashToken } from "../utils/token-hash.util";
import { ParentalConsentEmailService } from "./parental-consent-email.service";
import {
  PARENTAL_CONSENT_CGU_VERSION,
  PARENTAL_CONSENT_CONFIRMATION_TTL_DAYS,
  parentalConsentRequirement,
} from "./parental-consent.policy";
import {
  linkState,
  ParentalConsentLinkView,
  ParentalConsentQueryService,
  ParentalConsentView,
} from "./parental-consent.query-service";

const DAY_MS = 24 * 60 * 60 * 1000;

export const PARENTAL_CONSENT_NOT_REQUIRED_MESSAGE =
  "L'accord d'un représentant légal n'est pas nécessaire pour ce compte.";
export const PARENTAL_CONSENT_ALREADY_GRANTED_MESSAGE =
  "Un représentant légal a déjà donné son accord pour ce compte.";
export const PARENTAL_CONSENT_OWN_EMAIL_MESSAGE =
  "Indiquez l'adresse e-mail d'un parent ou représentant légal, pas la vôtre.";
export const PARENTAL_CONSENT_EXPIRED_MESSAGE =
  "Ce lien a expiré. Votre enfant peut vous renvoyer une demande depuis l'application.";
export const PARENTAL_CONSENT_REVOKED_MESSAGE =
  "Cet accord a été retiré. Votre enfant peut vous envoyer une nouvelle demande depuis l'application.";
export const PARENTAL_CONSENT_EMAIL_FAILED_MESSAGE =
  "L'e-mail n'a pas pu être envoyé pour le moment. Réessayez dans quelques minutes.";

/** SHA-256 of the normalised address: proves "this address" without keeping it. */
export function parentEmailHash(email: string): string {
  return hashToken(normalizeEmail(email));
}

/**
 * Writes of the parental consent (#61): e-mail double opt-in.
 *
 * 1. The minor gives a parent's address (`request`): a random token is
 *    e-mailed, only its SHA-256 is stored, with the hash and a masked form of
 *    the address — never the address itself.
 * 2. The parent opens the link and confirms (`confirm`), once, before
 *    `expiresAt`: the consent is timestamped and tied to a CGU version.
 * 3. The same link withdraws the consent (`revoke`), at any time. Withdrawal
 *    has a real effect: the account is restricted again and the minor's
 *    medical certificates are handed to the retention purge right away.
 */
@Injectable()
export class ParentalConsentService {
  private readonly logger = new Logger(ParentalConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: ParentalConsentEmailService,
    private readonly query: ParentalConsentQueryService,
  ) {}

  /**
   * Sends (or re-sends) the request to a parent. A request still pending is
   * replaced: its link stops working. A granted consent is never replaced.
   */
  async request(
    userId: string,
    parentEmail: string,
    now = new Date(),
  ): Promise<ParentalConsentView> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: parentalConsentSubjectSelect,
    });
    if (!user) throw new NotFoundException("Utilisateur introuvable");
    if (parentalConsentRequirement(user.birthDate, now) !== "REQUIRED") {
      throw new BadRequestException(PARENTAL_CONSENT_NOT_REQUIRED_MESSAGE);
    }

    const normalizedParentEmail = normalizeEmail(parentEmail);
    if (normalizedParentEmail === normalizeEmail(user.email)) {
      throw new BadRequestException(PARENTAL_CONSENT_OWN_EMAIL_MESSAGE);
    }

    const plainToken = crypto.randomBytes(32).toString("hex");
    const created = await this.prisma.$transaction(async (tx) => {
      const granted = await tx.parentalConsent.findFirst({
        where: { userId, status: "GRANTED" },
        select: idOnlySelect,
      });
      if (granted) {
        throw new ConflictException(PARENTAL_CONSENT_ALREADY_GRANTED_MESSAGE);
      }
      await tx.parentalConsent.updateMany({
        where: { userId, status: "PENDING" },
        data: { status: "SUPERSEDED", supersededAt: now },
      });
      return tx.parentalConsent.create({
        data: {
          userId,
          tokenHash: hashToken(plainToken),
          status: "PENDING",
          parentEmailHash: parentEmailHash(normalizedParentEmail),
          parentEmailMasked: maskEmail(normalizedParentEmail),
          cguVersion: PARENTAL_CONSENT_CGU_VERSION,
          requestedAt: now,
          expiresAt: new Date(
            now.getTime() + PARENTAL_CONSENT_CONFIRMATION_TTL_DAYS * DAY_MS,
          ),
        },
        select: idOnlySelect,
      });
    });

    try {
      await this.email.sendConsentRequest(
        normalizedParentEmail,
        user.firstName,
        plainToken,
      );
    } catch (error) {
      // Graceful degradation: a link nobody received must not stay "pending"
      // for a week. The request is withdrawn and the minor asked to retry.
      await this.prisma.parentalConsent.updateMany({
        where: { id: created.id, status: "PENDING" },
        data: { status: "SUPERSEDED", supersededAt: new Date() },
      });
      this.logger.warn(
        { userId, err: error instanceof Error ? error.message : "unknown" },
        "Parental consent e-mail failed; request withdrawn",
      );
      throw new ServiceUnavailableException(
        PARENTAL_CONSENT_EMAIL_FAILED_MESSAGE,
      );
    }

    this.logger.log({ userId }, "Parental consent requested");
    return this.query.getState(userId, now);
  }

  /**
   * Registration step (#61): the parent's address given in the sign-up form.
   * Best effort — the account exists already, and a failure here (adult
   * account, e-mail down…) must not turn a successful registration into an
   * error. The app shows the state and lets the minor send it again.
   */
  async requestAfterRegistration(
    userId: string,
    parentEmail: string,
  ): Promise<void> {
    try {
      await this.request(userId, parentEmail);
    } catch (error) {
      this.logger.warn(
        { userId, err: error instanceof Error ? error.message : "unknown" },
        "Parental consent not requested at registration",
      );
    }
  }

  /** The parent confirms. Idempotent on an already granted link. */
  async confirm(
    token: string,
    now = new Date(),
  ): Promise<ParentalConsentLinkView> {
    const record = await this.query.findByToken(token);
    const state = linkState(record.status, record.expiresAt, now);
    if (state === "EXPIRED") {
      throw new BadRequestException(PARENTAL_CONSENT_EXPIRED_MESSAGE);
    }
    if (state === "REVOKED") {
      throw new BadRequestException(PARENTAL_CONSENT_REVOKED_MESSAGE);
    }
    if (state === "PENDING") {
      // Conditional update: a concurrent re-send (SUPERSEDED) or withdrawal
      // between the read and the write wins, and this confirmation fails.
      const { count } = await this.prisma.parentalConsent.updateMany({
        where: { id: record.id, status: "PENDING", expiresAt: { gt: now } },
        data: { status: "GRANTED", grantedAt: now },
      });
      if (count !== 1) {
        throw new BadRequestException(PARENTAL_CONSENT_EXPIRED_MESSAGE);
      }
      this.logger.log({ userId: record.userId }, "Parental consent granted");
    }
    return this.query.lookup(token, now);
  }

  /**
   * The parent withdraws (or declines) the consent. Idempotent on an already
   * withdrawn link. When a consent had been GRANTED, the processing it
   * allowed stops (GDPR art. 7(3), 17(1)(b)):
   * - the account is restricted again (the gate reads the REVOKED row);
   * - a renewal awaiting a decision goes back to draft, out of the
   *   moderation queue, so that its certificate is no longer exempt from the
   *   purge;
   * - the minor's medical certificates lose their OCR data now and are due
   *   for deletion now: the hourly retention purge (#62) deletes the files.
   */
  async revoke(
    token: string,
    now = new Date(),
  ): Promise<ParentalConsentLinkView> {
    const record = await this.query.findByToken(token);
    if (record.status === "REVOKED") return this.query.lookup(token, now);

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.parentalConsent.updateMany({
        where: { id: record.id, status: { in: ["PENDING", "GRANTED"] } },
        data: { status: "REVOKED", revokedAt: now },
      });
      if (count !== 1) {
        throw new BadRequestException(PARENTAL_CONSENT_REVOKED_MESSAGE);
      }
      if (record.status !== "GRANTED") return;

      await tx.licenseRenewalRequest.updateMany({
        where: {
          userId: record.userId,
          status: LicenseRenewalStatus.PENDING,
        },
        data: { status: LicenseRenewalStatus.DRAFT, submittedAt: null },
      });
      await tx.licenseRenewalDocument.updateMany({
        where: {
          type: LicenseRenewalDocumentType.MEDICAL_CERTIFICATE,
          request: { userId: record.userId },
        },
        data: { ocrData: Prisma.DbNull, purgeDueAt: now },
      });
    });

    this.logger.log({ userId: record.userId }, "Parental consent revoked");
    return this.query.lookup(token, now);
  }
}
