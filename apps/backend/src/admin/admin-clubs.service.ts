import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, UserRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  adminClubEditableSelect,
  adminClubOptionSelect,
  adminClubStatusSelect,
} from "../utils/prisma-selects";
import { AdminAuditService } from "./admin-audit.service";
import { diffFields } from "./admin-audit.util";
import { clubUsage, isClubEmpty } from "./admin-club-usage";
import { AdminClubsQueryService } from "./admin-clubs.query-service";
import { AdminClubDetailDto, UpdateAdminClubDto } from "./dto/admin-clubs.dto";

const NAME_TAKEN = "Un club porte déjà ce nom";

/** Back-office writes on clubs. Every change is audited in the same tx. */
@Injectable()
export class AdminClubsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly query: AdminClubsQueryService,
  ) {}

  /**
   * Club.name is copied into User.clubName, License.clubName and
   * Competition.organizer: a rename rewrites every copy in the same
   * transaction. Users of another club are never touched; legacy members
   * without clubId are matched on the old name.
   */
  async update(
    actorId: string,
    clubId: string,
    dto: UpdateAdminClubDto,
  ): Promise<AdminClubDetailDto> {
    const requested: Record<string, unknown> = {
      ...(dto.name !== undefined && { name: dto.name.trim() }),
      ...(dto.registrationMode !== undefined && {
        registrationMode: dto.registrationMode,
      }),
    };
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.club.findUnique({
          where: { id: clubId },
          select: adminClubEditableSelect,
        });
        if (!current) throw new NotFoundException("Club introuvable");
        const diff = diffFields(current, requested);
        if (!diff) return;

        const newName =
          typeof diff.after.name === "string" ? diff.after.name : undefined;
        if (newName !== undefined) {
          const clash = await tx.club.findUnique({
            where: { name: newName },
            select: adminClubOptionSelect,
          });
          if (clash) {
            throw new ConflictException({
              message: NAME_TAKEN,
              existingClubId: clash.id,
            });
          }
        }

        await tx.club.update({
          where: { id: clubId },
          data: diff.after,
          select: { id: true },
        });
        if (newName !== undefined) {
          await tx.user.updateMany({
            where: {
              OR: [{ clubId }, { clubId: null, clubName: current.name }],
            },
            data: { clubName: newName },
          });
          await tx.license.updateMany({
            where: { clubName: current.name },
            data: { clubName: newName },
          });
          await tx.competition.updateMany({
            where: { organizer: current.name },
            data: { organizer: newName },
          });
        }
        await this.audit.record(tx, {
          actorId,
          action: "CLUB_UPDATE",
          targetType: "CLUB",
          targetId: clubId,
          before: diff.before,
          after: diff.after,
        });
      });
    } catch (err) {
      // Lost a race against a concurrent rename onto the same name.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException(NAME_TAKEN);
      }
      throw err;
    }
    return this.query.detail(clubId);
  }

  /**
   * Deactivation blocks the club's CLUB accounts (login, refresh, live
   * tokens) and revokes their sessions; its licensees are not affected.
   */
  async setStatus(
    actorId: string,
    clubId: string,
    active: boolean,
  ): Promise<AdminClubDetailDto> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.club.findUnique({
        where: { id: clubId },
        select: adminClubStatusSelect,
      });
      if (!current) throw new NotFoundException("Club introuvable");
      if ((current.disabledAt === null) === active) return;

      await tx.club.update({
        where: { id: clubId },
        data: { disabledAt: active ? null : new Date() },
        select: { id: true },
      });
      if (!active) {
        await tx.refreshToken.updateMany({
          where: { revoked: false, user: { clubId, role: UserRole.CLUB } },
          data: { revoked: true, revokedAt: new Date() },
        });
      }
      await this.audit.record(tx, {
        actorId,
        action: active ? "CLUB_ENABLE" : "CLUB_DISABLE",
        targetType: "CLUB",
        targetId: clubId,
      });
    });
    return this.query.detail(clubId);
  }

  /** Only an empty club can go; otherwise 409 with what still points at it. */
  async delete(actorId: string, clubId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const club = await tx.club.findUnique({
        where: { id: clubId },
        select: adminClubOptionSelect,
      });
      if (!club) throw new NotFoundException("Club introuvable");
      const usage = await clubUsage(tx, club);
      if (!isClubEmpty(usage)) {
        throw new ConflictException({
          message: "Ce club n'est pas vide : désactivez-le plutôt.",
          ...usage,
        });
      }
      await tx.club.delete({ where: { id: clubId }, select: { id: true } });
      await this.audit.record(tx, {
        actorId,
        action: "CLUB_DELETE",
        targetType: "CLUB",
        targetId: clubId,
        before: { name: club.name },
      });
    });
  }
}
