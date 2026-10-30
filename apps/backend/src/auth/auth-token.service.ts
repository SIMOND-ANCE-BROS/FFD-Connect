import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "@prisma/client";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { hashToken } from "../utils/token-hash.util";
import { accountStatusSelect, idOnlySelect } from "../utils/prisma-selects";
import { ACCOUNT_DISABLED_MESSAGE, accountBlockReason } from "./account-status";
import { rolesOf } from "./roles";
import { LoginResponse } from "./auth.service";

const INVALID_REFRESH_TOKEN = "Invalid or expired refresh token";

/**
 * How long after its rotation an already-rotated refresh token may come back
 * without being treated as stolen (#687). It absorbs a legitimate race: two
 * app instances or back-office tabs sending the same token a few seconds
 * apart, or a client retrying right after losing the rotation response. The
 * late request is still refused (401) — the window only spares the family.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;

/**
 * Serialises every change to a user's refresh tokens on the user row: a
 * rotation and a revocation can no longer interleave so that the revocation's
 * READ COMMITTED snapshot misses the token the rotation inserts (#687, raised
 * in the review of #686).
 */
async function lockUserSessions(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`,
  );
}

@Injectable()
export class AuthTokenService {
  private readonly logger = new Logger(AuthTokenService.name);
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

    // A login starts a new family (#687), rooted at the token itself.
    const id = crypto.randomUUID();
    const record = await this.prisma.refreshToken.create({
      data: {
        id,
        token: tokenHash,
        userId,
        expiresAt,
        familyId: id,
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

    if (!tokenRecord) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }
    // A token issued before #687 has no familyId: its family is its own id.
    const familyId = tokenRecord.familyId ?? tokenRecord.id;

    if (tokenRecord.revoked) {
      await this.handleRevokedTokenReuse(tokenRecord, familyId);
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }
    if (tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
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
    // updateMany is the real gate — the second writer re-evaluates
    // `revoked: false` after the first commits and matches nothing. Exactly
    // one caller rotates; the loser gets the same 401 as a revoked token and
    // nothing else happens. It raced the winner by milliseconds: a legitimate
    // client racing itself across tabs/app instances (#676), never a replay,
    // so no family revocation either (#687).
    const now = new Date();
    const rotated = await this.prisma.$transaction(async (tx) => {
      // User row first, then token rows: the same lock order as every
      // revocation, so a concurrent "revoke all" cannot miss the new token.
      await lockUserSessions(tx, user.id);
      const consumed = await tx.refreshToken.updateMany({
        where: { id: tokenRecord.id, revoked: false, expiresAt: { gt: now } },
        data: { revoked: true, revokedAt: now },
      });
      if (consumed.count !== 1) {
        return false;
      }
      // The new token stays in its parent's family (a pre-#687 parent's id
      // becomes the family id, joining the chain to its root).
      await tx.refreshToken.create({
        data: { token: newTokenHash, userId: user.id, expiresAt, familyId },
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
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
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
    // Under the user lock: a rotation in flight has either committed (its new
    // token is visible here and gets revoked) or runs afterwards and finds
    // its own token already revoked.
    const result = await this.prisma.$transaction(async (tx) => {
      await lockUserSessions(tx, userId);
      return tx.refreshToken.updateMany({
        where: {
          userId,
          revoked: false,
        },
        data: {
          revoked: true,
          revokedAt: new Date(),
        },
      });
    });

    return result.count;
  }

  /**
   * An already-revoked refresh token came back (#687). Within the grace
   * window it is a legitimate late racer: refused, nothing else. Beyond it,
   * whoever presents it replays a credential that was rotated away — the
   * thief, or the victim whose token the thief already rotated — so the whole
   * family, its live descendant included, is revoked. The user's other
   * families (other devices, other logins) are never touched.
   *
   * A token revoked by logout, password reset or an admin has no live
   * descendant: the family revocation then matches nothing.
   */
  private async handleRevokedTokenReuse(
    token: { userId: string; revokedAt: Date | null },
    familyId: string,
  ): Promise<void> {
    if (
      token.revokedAt &&
      Date.now() - token.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS
    ) {
      return;
    }

    const revoked = await this.prisma.$transaction(async (tx) => {
      await lockUserSessions(tx, token.userId);
      return tx.refreshToken.updateMany({
        where: {
          userId: token.userId,
          revoked: false,
          // `id` also catches a pre-#687 root, whose familyId is still null.
          OR: [{ familyId }, { id: familyId }],
        },
        data: { revoked: true, revokedAt: new Date() },
      });
    });

    // Ids only: never the token, never an e-mail address.
    this.logger.warn(
      `Refresh token reuse detected (user ${token.userId}, family ${familyId}): ${revoked.count} live token(s) revoked`,
    );
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
