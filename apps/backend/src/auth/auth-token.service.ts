import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { accountStatusSelect } from "../utils/prisma-selects";
import { ACCOUNT_DISABLED_MESSAGE, accountBlockReason } from "./account-status";
import { LoginResponse } from "./auth.service";

@Injectable()
export class AuthTokenService {
  private readonly REFRESH_TOKEN_EXPIRY_DAYS = 30;
  private readonly ACCESS_TOKEN_EXPIRY_MINUTES = 60;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  /** Hash a token with SHA-256 for secure storage. Only the hash is persisted. */
  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  async createRefreshToken(userId: string) {
    const plainToken = crypto.randomBytes(64).toString("hex");
    const tokenHash = this.hashToken(plainToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.REFRESH_TOKEN_EXPIRY_DAYS);

    await this.cleanupExpiredTokens(userId);

    const record = await this.prisma.refreshToken.create({
      data: {
        token: tokenHash,
        userId,
        expiresAt,
      },
    });

    // Return plain token for the caller to send to client (DB only stores hash)
    return { ...record, token: plainToken };
  }

  async refreshAccessToken(refreshToken: string): Promise<LoginResponse> {
    const tokenHash = this.hashToken(refreshToken);
    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: tokenHash },
      include: {
        user: {
          select: {
            ...accountStatusSelect,
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            clubId: true,
            clubName: true,
            category: true,
            ageGroup: true,
            passportLevelLatin: true,
            passportLevelStandard: true,
            license: {
              select: {
                number: true,
              },
            },
          },
        },
      },
    });

    if (
      !tokenRecord ||
      tokenRecord.revoked ||
      tokenRecord.expiresAt < new Date()
    ) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

    const user = tokenRecord.user;

    // A disabled account's session is over, whatever the token says.
    if (accountBlockReason(user)) {
      throw new UnauthorizedException(ACCOUNT_DISABLED_MESSAGE);
    }

    const newPlainToken = crypto.randomBytes(64).toString("hex");
    const newTokenHash = this.hashToken(newPlainToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.REFRESH_TOKEN_EXPIRY_DAYS);

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: tokenRecord.id },
        data: { revoked: true, revokedAt: new Date() },
      }),
      this.prisma.refreshToken.create({
        data: { token: newTokenHash, userId: user.id, expiresAt },
      }),
      // A refresh is a returning session: keep lastLoginAt meaningful for
      // users who stay logged in and never go through login() again.
      this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
        select: { id: true },
      }),
    ]);

    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
      clubName: user.clubName,
    };
    const access_token = this.jwtService.sign(payload, {
      expiresIn: `${this.ACCESS_TOKEN_EXPIRY_MINUTES}m`,
    });

    return {
      access_token,
      refresh_token: newPlainToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        clubId: user.clubId,
        clubName: user.clubName,
        licenseNumber: user.license?.number,
        category: user.category ?? null,
        ageGroup: user.ageGroup ?? null,
        passportLevelLatin: user.passportLevelLatin ?? null,
        passportLevelStandard: user.passportLevelStandard ?? null,
      },
    };
  }

  async revokeRefreshToken(refreshToken: string): Promise<boolean> {
    const tokenHash = this.hashToken(refreshToken);
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        token: tokenHash,
        revoked: false,
      },
      data: {
        revoked: true,
        revokedAt: new Date(),
      },
    });

    return result.count > 0;
  }

  async revokeAllUserTokens(userId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revoked: false,
      },
      data: {
        revoked: true,
        revokedAt: new Date(),
      },
    });

    return result.count;
  }

  private async cleanupExpiredTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: {
        userId,
        expiresAt: {
          lt: new Date(),
        },
      },
    });
  }
}
