import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { UserRole } from "@prisma/client";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../prisma/prisma.service";
import { accountStatusSelect } from "../utils/prisma-selects";
import { ACCOUNT_DISABLED_MESSAGE, accountBlockReason } from "./account-status";
import { JwtPayload } from "./interfaces/jwt-payload.interface";
import { hasRole, rolesOf } from "./roles";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>("JWT_SECRET"),
    });
  }

  /**
   * Runs on every authenticated request. The account status comes from the
   * database (one primary-key lookup) so a deactivation cuts live access
   * tokens at once instead of when they expire (up to 60 minutes).
   */
  async validate(payload: JwtPayload) {
    const account = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: accountStatusSelect,
    });
    if (!account) throw new UnauthorizedException();
    if (accountBlockReason(account)) {
      throw new UnauthorizedException(ACCOUNT_DISABLED_MESSAGE);
    }
    if (payload.impersonatedBy) {
      // Impersonation is ADMIN-only: the admin behind the token must still be
      // an active ADMIN, or the session dies with their demotion/deactivation.
      const impersonator = await this.prisma.user.findUnique({
        where: { id: payload.impersonatedBy },
        select: accountStatusSelect,
      });
      if (
        !impersonator ||
        accountBlockReason(impersonator) ||
        !hasRole(impersonator, UserRole.ADMIN)
      ) {
        throw new UnauthorizedException();
      }
    }
    return {
      userId: payload.sub,
      email: payload.email,
      // The database roles, not the (possibly stale) token claim.
      role: account.role,
      roles: rolesOf(account),
      impersonatedBy: payload.impersonatedBy,
    };
  }
}
