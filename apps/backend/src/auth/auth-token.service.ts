import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { hashToken } from "../utils/token-hash.util";
import { accountStatusSelect, idOnlySelect } from "../utils/prisma-selects";
import { ACCOUNT_DISABLED_MESSAGE, accountBlockReason } from "./account-status";
import { rolesOf } from "./roles";
import { LoginResponse } from "./auth.service";

@Injectable()
export class AuthTokenService {
  private readonly REFRESH_TOKEN_EXPIRY_DAYS = 30;
  private readonly ACCESS_TOKEN_EXPIRY_MINUTES = 60;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async createRefreshToken(userId: string) {
    const plainToken = crypto.randomBytes(64).toString("hex");
    const tokenHash = hashToken(plainToken);
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
    const tokenHash = hashToken(refreshToken);
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
    const newTokenHash = hashToken(newPlainToken);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.REFRESH_TOKEN_EXPIRY_DAYS);

    // Atomic consumption (#681). The read above is only a fast path: two
    // concurrent refreshes with the same token both pass it. The conditional
    // updateMany is the real gate — Postgres row-locks the token, the second
    // writer re-evaluates `revoked: false` after the first commits and matches
    // nothing. Exactly one caller rotates; the loser gets the same 401 as a
    // revoked token and nothing else happens (no session-wide revocation: a
    // legitimate client racing itself across tabs/app instances must not be
    // logged out — it picks up the tokens the winner stored, cf. #676).
    const now = new Date();
    const rotated = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.refreshToken.updateMany({
        where: { id: tokenRecord.id, revoked: false, expiresAt: { gt: now } },
        data: { revoked: true, revokedAt: now },
      });
      if (consumed.count !== 1) {
        return false;
      }
      await tx.refreshToken.create({
        data: { token: newTokenHash, userId: user.id, expiresAt },
        select: idOnlySelect,
      });
      // A refresh is a returning session: keep lastLoginAt meaningful for
      // users who stay logged in and never go through login() again.
      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: now },
        select: idOnlySelect,
      });
      return true;
    });

    if (!rotated) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }

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
        roles: rolesOf(user),
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
    const tokenHash = hashToken(refreshToken);
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
