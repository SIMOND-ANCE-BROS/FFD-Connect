import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  idOnlySelect,
  passwordResetTargetSelect,
} from "../utils/prisma-selects";
import { hashToken } from "../utils/token-hash.util";
import { findUserIdByEmail } from "./email-identity";
import { EmailSendError, EmailService } from "./email.service";
import { AuthTokenService } from "./auth-token.service";
import { PasswordValidator } from "./password-validator";

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthPasswordService {
  private readonly logger = new Logger(AuthPasswordService.name);
  private readonly PASSWORD_RESET_TOKEN_EXPIRY_HOURS = 1;

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private authTokenService: AuthTokenService,
  ) {}

  /**
   * Issues a single-use password token (reset or invitation): previous unused
   * tokens of the user are invalidated, only the SHA-256 hash is stored, and
   * the plain token is returned for the email link.
   */
  async issuePasswordToken(
    userId: string,
    expiryHours: number,
  ): Promise<string> {
    await this.prisma.passwordResetToken.updateMany({
      where: { userId, used: false },
      data: { used: true, usedAt: new Date() },
    });

    const plainToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + expiryHours * 3600_000);
    await this.prisma.passwordResetToken.create({
      data: { token: hashToken(plainToken), userId, expiresAt },
    });
    return plainToken;
  }

  /**
   * Always answers `{ success: true }` and, as far as the caller can time
   * it, does the same work whether the address has an account or not (#610):
   * - the same queries run on every path: an unknown address (or the
   *   store-review account) runs a decoy of the token issuance that matches
   *   no row and writes nothing;
   * - the Resend call is never awaited: it runs detached, its failure is
   *   logged (masked address, by EmailService) and reported without PII.
   */
  async forgotPassword(email: string): Promise<{ success: boolean }> {
    // Case / spaces of the typed address do not matter (#465).
    const userId = await findUserIdByEmail(this.prisma, email);
    // Same lookup on every path: an unknown address reads a random id that
    // matches nobody instead of skipping the query.
    const user = await this.prisma.user.findUnique({
      where: { id: userId ?? crypto.randomUUID() },
      select: passwordResetTargetSelect,
    });

    // The store-review account's password is shared with Apple / Google: no
    // reset link is ever issued for it (same generic answer as an unknown email).
    if (!user || user.isStoreReview) {
      await this.issueDecoyPasswordToken();
      return { success: true };
    }

    const plainToken = await this.issuePasswordToken(
      user.id,
      this.PASSWORD_RESET_TOKEN_EXPIRY_HOURS,
    );

    // Send plain token via email (DB only stores hash), to the stored address:
    // never to the variant typed in the form. Not awaited (#610): waiting for
    // Resend (up to the send timeout) would tell that the address has an
    // account, and so would a 5xx on a mail outage (#464).
    this.sendPasswordResetEmailDetached(user.email, plainToken);

    return { success: true };
  }

  /**
   * Mirrors `issuePasswordToken` without touching any row (#610): the same
   * token generation and hashing, an `updateMany` on a random user id that
   * matches nothing, and a unique-index probe on the hash column in place of
   * the insert. No junk row is ever written.
   */
  private async issueDecoyPasswordToken(): Promise<void> {
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: crypto.randomUUID(), used: false },
      data: { used: true, usedAt: new Date() },
    });
    const decoyHash = hashToken(crypto.randomBytes(32).toString("hex"));
    await this.prisma.passwordResetToken.findUnique({
      where: { token: decoyHash },
      select: idOnlySelect,
    });
  }

  /**
   * Fire-and-forget password-reset mail (#610). A failure (open breaker,
   * timeout, Resend error) is already logged with a masked address by
   * EmailService; it is reported here by its kind only: never the address,
   * the token nor Resend's message.
   */
  private sendPasswordResetEmailDetached(to: string, token: string): void {
    void this.emailService
      .sendPasswordResetEmail(to, token)
      .catch((error: unknown) => {
        const kind = error instanceof Error ? error.name : "unknown";
        const status =
          error instanceof EmailSendError && error.statusCode != null
            ? ` ${error.statusCode}`
            : "";
        const message = `Password reset e-mail not sent (${kind}${status})`;
        this.logger.warn(message);
        Sentry.captureException(new Error(message));
      });
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ success: boolean }> {
    const validation = PasswordValidator.validate(newPassword);
    if (!validation.isValid) {
      throw new BadRequestException({
        message: "Le mot de passe ne respecte pas la politique de sécurité",
        errors: validation.errors,
      });
    }

    const tokenHash = hashToken(token);
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { token: tokenHash },
      select: {
        id: true,
        userId: true,
        used: true,
        expiresAt: true,
      },
    });

    if (!resetToken || resetToken.used || resetToken.expiresAt < new Date()) {
      throw new BadRequestException(
        "Token de réinitialisation invalide, expiré ou déjà utilisé",
      );
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await this.prisma.user.update({
      where: { id: resetToken.userId },
      data: { password: hashedPassword },
    });

    await this.prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: {
        used: true,
        usedAt: new Date(),
      },
    });

    await this.authTokenService.revokeAllUserTokens(resetToken.userId);

    return { success: true };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true },
    });

    if (!user) {
      throw new NotFoundException("Utilisateur non trouvé");
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException("Mot de passe actuel incorrect");
    }

    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      throw new BadRequestException(
        "Le nouveau mot de passe doit être différent de l'ancien",
      );
    }

    const validation = PasswordValidator.validate(newPassword);
    if (!validation.isValid) {
      throw new BadRequestException({
        message: "Le mot de passe ne respecte pas la politique de sécurité",
        errors: validation.errors,
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return { success: true };
  }
}
