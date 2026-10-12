import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { EmailService } from "../auth/email.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  adminUserIdentifiersSelect,
  idOnlySelect,
  retiredLicenseNumberSelect,
} from "../utils/prisma-selects";
import { AdminAuditService } from "./admin-audit.service";
import { AdminUsersQueryService } from "./admin-users.query-service";
import {
  AdminUserIdentifiersUpdatedDto,
  UpdateAdminUserIdentifiersDto,
} from "./dto/admin-user-identifiers.dto";

export const EMAIL_TAKEN = "Cet email est déjà utilisé par un autre compte";
export const LICENSE_NUMBER_TAKEN =
  "Ce numéro de licence est déjà attribué à une autre licence";
export const NO_LICENSE =
  "Ce compte n'a pas de licence rattachée : son numéro ne peut pas être modifié";
export const STORE_REVIEW_IDENTIFIERS =
  "Ce compte est utilisé pour les validations App Store / Google Play : son email et son numéro de licence ne peuvent pas être modifiés.";

/** Error name, plus its code when it has one: never its message. */
function errorKind(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const { code } = error as Error & { code?: unknown };
  return typeof code === "string" || typeof code === "number"
    ? `${error.name} (${code})`
    : error.name;
}

/** Changed identifiers only: the audit diff (before / after). */
interface Identifiers {
  email?: string;
  licenseNumber?: string;
}

interface IdentifiersChange {
  userId: string;
  firstName: string;
  /** Previous login email when it changed, else null. */
  previousEmail: string | null;
}

/**
 * Back-office change of a user's login email and licence number (#448).
 *
 * Effects, all in the transaction of the change and its audit row:
 * - email: case-insensitive uniqueness (409); every refresh token revoked
 *   (the next refresh fails, the person logs in again with the new address);
 *   every pending password link (reset or invitation, sent to the previous
 *   address) invalidated. There is no email-verification state to reset.
 *   After the commit, the previous address is told (best effort).
 * - licence number: renames the licence attached to the account in place, so
 *   its validity, renewals and the user link stay; QR codes and Wallet passes
 *   are generated from the current number. Uniqueness is exact, like every
 *   lookup by number (registration, check-in): 409 on a taken number.
 *   QR codes and Wallet passes already issued carry the old number: a signed
 *   v2 QR also carries the licence id, so the check-in tells it no longer
 *   matches (#466); the old number is recorded as retired so a number-only
 *   QR (v1, unsigned) is refused for it. Either way the holder regenerates
 *   the QR from the app (and re-adds the Wallet pass).
 *
 * The audit row holds the previous and new values; application logs only
 * ever carry the user id.
 */
@Injectable()
export class AdminUserIdentifiersService {
  private readonly logger = new Logger(AdminUserIdentifiersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly query: AdminUsersQueryService,
    private readonly email: EmailService,
  ) {}

  async update(
    actorId: string,
    userId: string,
    dto: UpdateAdminUserIdentifiersDto,
  ): Promise<AdminUserIdentifiersUpdatedDto> {
    if (dto.email === undefined && dto.licenseNumber === undefined) {
      throw new BadRequestException(
        "Indiquer un email ou un numéro de licence",
      );
    }
    // Out of scope (#448), and it would end the acting admin's own sessions.
    if (actorId === userId) {
      throw new ForbiddenException(
        "Un administrateur ne peut pas modifier ses propres identifiants",
      );
    }

    let change: IdentifiersChange | null;
    try {
      change = await this.prisma.$transaction((tx) =>
        this.apply(tx, actorId, userId, dto),
      );
    } catch (err) {
      throw this.mapUniqueViolation(err);
    }

    const previousEmail = change?.previousEmail ?? null;
    const previousEmailNotified =
      change && previousEmail
        ? await this.notifyPreviousEmail(change, previousEmail)
        : null;
    return { user: await this.query.detail(userId), previousEmailNotified };
  }

  private async apply(
    tx: Prisma.TransactionClient,
    actorId: string,
    userId: string,
    dto: UpdateAdminUserIdentifiersDto,
  ): Promise<IdentifiersChange | null> {
    const current = await tx.user.findUnique({
      where: { id: userId },
      select: adminUserIdentifiersSelect,
    });
    if (!current) throw new NotFoundException("Utilisateur introuvable");
    // The whole route is locked for the store-review account: Apple / Google
    // log in with its email, and its licence backs the demo e-licence.
    if (current.isStoreReview) {
      throw new ForbiddenException(STORE_REVIEW_IDENTIFIERS);
    }

    const before: Identifiers = {};
    const after: Identifiers = {};

    // The DTO lower-cases; a stored legacy casing of the same address is no change.
    if (dto.email !== undefined && dto.email !== current.email.toLowerCase()) {
      const taken = await tx.user.findFirst({
        where: {
          email: { equals: dto.email, mode: "insensitive" },
          id: { not: userId },
        },
        select: idOnlySelect,
      });
      if (taken) throw new ConflictException(EMAIL_TAKEN);
      before.email = current.email;
      after.email = dto.email;
    }

    if (
      dto.licenseNumber !== undefined &&
      dto.licenseNumber !== current.license?.number
    ) {
      if (!current.license) throw new BadRequestException(NO_LICENSE);
      const taken = await tx.license.findUnique({
        where: { number: dto.licenseNumber },
        select: idOnlySelect,
      });
      if (taken) throw new ConflictException(LICENSE_NUMBER_TAKEN);
      before.licenseNumber = current.license.number;
      after.licenseNumber = dto.licenseNumber;
    }

    if (Object.keys(after).length === 0) return null;

    if (after.email !== undefined) {
      const now = new Date();
      await tx.user.update({
        where: { id: userId },
        data: { email: after.email },
        select: idOnlySelect,
      });
      await tx.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true, revokedAt: now },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId, used: false },
        data: { used: true, usedAt: now },
      });
    }
    if (after.licenseNumber !== undefined && current.license) {
      await tx.license.update({
        where: { id: current.license.id },
        data: { number: after.licenseNumber },
        select: idOnlySelect,
      });
      // #466: QR codes bound to the number alone (signed v1, legacy unsigned)
      // must never resolve this number again — it may be reassigned. Signed
      // v2 QR codes carry the licence id and need no bookkeeping.
      await tx.retiredLicenseNumber.upsert({
        where: { number: current.license.number },
        create: {
          number: current.license.number,
          licenseId: current.license.id,
        },
        update: { licenseId: current.license.id, retiredAt: new Date() },
        select: retiredLicenseNumberSelect,
      });
    }

    await this.audit.record(tx, {
      actorId,
      action: "USER_IDENTIFIERS_UPDATE",
      targetType: "USER",
      targetId: userId,
      before: { ...before },
      after: { ...after },
    });
    return {
      userId,
      firstName: current.firstName,
      previousEmail: before.email ?? null,
    };
  }

  /** Lost a race to a concurrent write: same 409 as the pre-checks. */
  private mapUniqueViolation(err: unknown): unknown {
    if (
      !(err instanceof Prisma.PrismaClientKnownRequestError) ||
      err.code !== "P2002"
    ) {
      return err;
    }
    const target = JSON.stringify(err.meta?.target ?? "").toLowerCase();
    if (target.includes("email")) return new ConflictException(EMAIL_TAKEN);
    if (target.includes("number")) {
      return new ConflictException(LICENSE_NUMBER_TAKEN);
    }
    return err;
  }

  /** Graceful degradation: the change is committed whatever the mail does. */
  private async notifyPreviousEmail(
    change: IdentifiersChange,
    previousEmail: string,
  ): Promise<boolean> {
    try {
      await this.email.sendEmailChangedNotice(previousEmail, change.firstName);
      return true;
    } catch (error) {
      // Never the provider's message: it may echo the recipient address.
      this.logger.warn(
        `Email-changed notice not sent for user ${change.userId}: ${errorKind(error)}`,
      );
      return false;
    }
  }
}
