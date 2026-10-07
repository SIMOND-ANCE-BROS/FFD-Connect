import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { AuthTokenService } from "../auth/auth-token.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  adminClubOptionSelect,
  adminUserEditableSelect,
} from "../utils/prisma-selects";
import { AdminAuditService } from "./admin-audit.service";
import { diffFields } from "./admin-audit.util";
import { AdminUsersQueryService } from "./admin-users.query-service";
import { AdminUserDetailDto } from "./dto/admin-users.dto";
import { UpdateAdminUserDto } from "./dto/update-admin-user.dto";

/** Back-office writes on users. Every change is audited in the same tx. */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly query: AdminUsersQueryService,
    private readonly tokens: AuthTokenService,
  ) {}

  async update(
    actorId: string,
    userId: string,
    dto: UpdateAdminUserDto,
  ): Promise<AdminUserDetailDto> {
    if (dto.role !== undefined && actorId === userId) {
      throw new ForbiddenException(
        "Un administrateur ne peut pas modifier son propre rôle",
      );
    }

    let roleChanged = false;
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: adminUserEditableSelect,
      });
      if (!current) throw new NotFoundException("Utilisateur introuvable");

      // Only keys actually present in the body (null = clear).
      const requested: Record<string, unknown> = Object.fromEntries(
        Object.entries(dto).filter(([, v]) => v !== undefined),
      );

      if (dto.clubId !== undefined) {
        if (dto.clubId === null) {
          requested.clubName = null;
        } else {
          const club = await tx.club.findUnique({
            where: { id: dto.clubId },
            select: adminClubOptionSelect,
          });
          if (!club) throw new BadRequestException("Club introuvable");
          requested.clubName = club.name;
        }
      }

      const diff = diffFields(current, requested);
      if (!diff) return;

      await tx.user.update({
        where: { id: userId },
        data: diff.after,
        select: { id: true },
      });
      roleChanged = "role" in diff.after;
      await this.audit.record(tx, {
        actorId,
        action: "USER_UPDATE",
        targetType: "USER",
        targetId: userId,
        before: diff.before,
        after: diff.after,
      });
    });

    // Defence in depth: /auth/refresh already re-reads the role from the
    // database, so a renewed access token carries the new role either way.
    // Revoking forces a fresh login after a role change. It runs after the
    // commit, so a failure here must not turn a saved update into a 500.
    if (roleChanged) await this.revokeSessions(userId);

    return this.query.detail(userId);
  }

  private async revokeSessions(userId: string): Promise<void> {
    try {
      await this.tokens.revokeAllUserTokens(userId);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Role changed for user ${userId} but refresh-token revocation failed: ${reason}`,
      );
    }
  }
}
