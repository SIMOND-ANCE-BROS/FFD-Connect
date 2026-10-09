import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { AuthTokenService } from "../auth/auth-token.service";
import { normalizeExtraRoles, rolesOf } from "../auth/roles";
import { assertUserNotStoreReview } from "../auth/store-review/store-review-protection";
import { PrismaService } from "../prisma/prisma.service";
import { AccountDeletionService } from "../users/account-deletion.service";
import {
  adminClubAttachSelect,
  adminUserDeletionTargetSelect,
  adminUserEditableSelect,
  adminUserStatusSelect,
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
    private readonly deletion: AccountDeletionService,
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
            select: adminClubAttachSelect,
          });
          if (!club) throw new BadRequestException("Club introuvable");
          if (club.disabledAt && dto.clubId !== current.clubId) {
            throw new BadRequestException("Ce club est désactivé");
          }
          requested.clubName = club.name;
        }
      }

      // A role promoted to main leaves the extras; the list is stored normalised.
      const finalRole =
        (requested.role as UserRole | undefined) ?? current.role;
      const finalExtras = normalizeExtraRoles(
        finalRole,
        (requested.extraRoles as UserRole[] | undefined) ?? current.extraRoles,
      );
      if (
        dto.extraRoles !== undefined ||
        finalExtras.length !== current.extraRoles.length
      ) {
        requested.extraRoles = finalExtras;
      }
      const finalClubId =
        dto.clubId !== undefined ? dto.clubId : current.clubId;
      if (finalExtras.includes(UserRole.CLUB) && !finalClubId) {
        throw new BadRequestException(
          "Un rôle Club supplémentaire nécessite un club",
        );
      }
      if (
        actorId === userId &&
        !rolesOf({ role: finalRole, extraRoles: finalExtras }).includes(
          UserRole.ADMIN,
        )
      ) {
        throw new ForbiddenException(
          "Un administrateur ne peut pas retirer son propre rôle Admin",
        );
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

  /**
   * Reversible measure. Deactivation revokes every refresh token in the same
   * transaction; live access tokens are refused by JwtStrategy right away.
   * Asking for the state already in place writes and audits nothing.
   */
  async setStatus(
    actorId: string,
    userId: string,
    active: boolean,
  ): Promise<AdminUserDetailDto> {
    if (actorId === userId) {
      throw new ForbiddenException(
        "Un administrateur ne peut pas changer le statut de son propre compte",
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: adminUserStatusSelect,
      });
      if (!current) throw new NotFoundException("Utilisateur introuvable");
      if (!active) assertUserNotStoreReview(current, "disable");
      if ((current.disabledAt === null) === active) return;

      await tx.user.update({
        where: { id: userId },
        data: { disabledAt: active ? null : new Date() },
        select: { id: true },
      });
      if (!active) {
        await tx.refreshToken.updateMany({
          where: { userId, revoked: false },
          data: { revoked: true, revokedAt: new Date() },
        });
      }
      await this.audit.record(tx, {
        actorId,
        action: active ? "USER_ENABLE" : "USER_DISABLE",
        targetType: "USER",
        targetId: userId,
      });
    });
    return this.query.detail(userId);
  }

  /**
   * Final RGPD deletion, same core as the in-app self-service deletion.
   * The admin re-types the email; the audit row keeps only the role and is
   * appended to the core's transaction, after the purge of rows about the user.
   */
  async delete(
    actorId: string,
    userId: string,
    confirmEmail: string,
  ): Promise<void> {
    if (actorId === userId) {
      throw new ForbiddenException(
        "Un administrateur ne peut pas supprimer son propre compte",
      );
    }
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: adminUserDeletionTargetSelect,
    });
    if (!target) throw new NotFoundException("Utilisateur introuvable");
    assertUserNotStoreReview(target, "delete");
    if (target.email.toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      throw new BadRequestException(
        "L'email saisi ne correspond pas au compte",
      );
    }
    await this.deletion.deleteAccount(userId, [
      this.audit.recordOp({
        actorId,
        action: "USER_DELETE",
        targetType: "USER",
        targetId: userId,
        after: { role: target.role },
      }),
    ]);
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
