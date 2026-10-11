import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { hashToken } from "../utils/token-hash.util";
import { EmailService } from "./email.service";
import { AuthTokenService } from "./auth-token.service";
import { PasswordValidator } from "./password-validator";

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthPasswordService {
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

  async forgotPassword(email: string): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // The store-review account's password is shared with Apple / Google: no
    // reset link is ever issued for it (same generic answer as an unknown email).
    if (!user || user.isStoreReview) {
      return { success: true };
    }

    const plainToken = await this.issuePasswordToken(
      user.id,
      this.PASSWORD_RESET_TOKEN_EXPIRY_HOURS,
    );

    // Send plain token via email (DB only stores hash)
    await this.emailService.sendPasswordResetEmail(email, plainToken);

    return { success: true };
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
