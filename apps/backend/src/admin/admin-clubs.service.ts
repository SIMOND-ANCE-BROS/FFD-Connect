import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ClubRegistrationMode, Prisma, UserRole } from "@prisma/client";
import { assertClubNotStoreReview } from "../auth/store-review/store-review-protection";
import { matchClubByName } from "../competitions/competition-organizer";
import { PrismaService } from "../prisma/prisma.service";
import {
  adminClubDeletionTargetSelect,
  adminClubEditableSelect,
  adminClubOptionSelect,
  adminClubStatusSelect,
  idOnlySelect,
} from "../utils/prisma-selects";
import { AdminAuditService } from "./admin-audit.service";
import { diffFields } from "./admin-audit.util";
import {
  clubUsage,
  isClubEmpty,
  organizedByClubOrLabel,
  sameClubName,
} from "./admin-club-usage";
import { AdminClubsQueryService } from "./admin-clubs.query-service";
import {
  AdminClubDetailDto,
  CreateAdminClubDto,
  UpdateAdminClubDto,
} from "./dto/admin-clubs.dto";

const NAME_TAKEN = "Un club porte déjà ce nom";
const AMBIGUOUS_UNLINKED_COMPETITIONS =
  "Un autre club porte ce nom à la casse près et des compétitions non rattachées portent ce nom : rattachez-les à leur club avant de renommer.";
/** Upper bound of the competition ids listed in that 409. */
const MAX_AMBIGUOUS_COMPETITIONS_LISTED = 20;
const FFD_SYNCED_NAME =
  "Ce club organise des compétitions synchronisées avec la FFD : son nom ne peut pas être changé ici (la synchronisation rétablirait l'ancien nom).";

/** Back-office writes on clubs. Every change is audited in the same tx. */
@Injectable()
export class AdminClubsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly query: AdminClubsQueryService,
  ) {}

  /** Names are unique ignoring case, so "club a" cannot sit beside "Club A". */
  async create(
    actorId: string,
    dto: CreateAdminClubDto,
  ): Promise<AdminClubDetailDto> {
    const name = dto.name.trim();
    const registrationMode =
      dto.registrationMode ?? ClubRegistrationMode.MEMBERS_AUTO_CONFIRM;
    let clubId: string;
    try {
      clubId = await this.prisma.$transaction(async (tx) => {
        // App-level check, case-insensitive. The DB unique constraint is
        // case-sensitive, so a race between two names differing only by case
        // can still slip through; follow-up: a unique index on lower(name).
        const clash = await tx.club.findFirst({
          where: { name: sameClubName(name) },
          select: adminClubOptionSelect,
        });
        if (clash) {
          throw new ConflictException({
            message: NAME_TAKEN,
            existingClubId: clash.id,
          });
        }
        const created = await tx.club.create({
          data: { name, registrationMode },
          select: idOnlySelect,
        });
        await this.audit.record(tx, {
          actorId,
          action: "CLUB_CREATE",
          targetType: "CLUB",
          targetId: created.id,
          after: { name, registrationMode },
        });
        return created.id;
      });
    } catch (err) {
      // Lost a race against a concurrent create of the same name.
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
   * Club.name is copied into User.clubName, License.clubName and the
   * Competition.organizer label: a rename rewrites every copy in the same
   * transaction. Users of another club are never touched; legacy members
   * without clubId are matched on the old name (case-insensitive). The
   * competitions rewritten are the club's (organizerClubId, #408); unlinked
   * ones carrying its old name are relabelled AND linked to it, only when no
   * homonym club shares that name (otherwise left untouched).
   * The FFD sync rewrites Competition.organizer on every run and links the
   * club by that name, so a club that organises FFD-synced competitions
   * cannot be renamed here: the rename would be silently undone.
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
        // Unlinked competitions labelled with the old name belong to this
        // club only if no homonym club (same name up to case) exists —
        // read before the rename changes the name (#408).
        let ownsUnlinkedByName = false;
        if (newName !== undefined) {
          const match = await matchClubByName(tx, current.name);
          ownsUnlinkedByName =
            match.kind === "match" && match.clubId === clubId;
          if (match.kind === "ambiguous") {
            // Renaming would leave these rows to the homonym alone: refuse
            // until an admin links or relabels them (#408).
            const ambiguous = await tx.competition.findMany({
              where: {
                organizerClubId: null,
                organizer: sameClubName(current.name),
              },
              select: idOnlySelect,
              orderBy: { id: "asc" },
              take: MAX_AMBIGUOUS_COMPETITIONS_LISTED,
            });
            if (ambiguous.length > 0) {
              throw new ConflictException({
                message: AMBIGUOUS_UNLINKED_COMPETITIONS,
                competitionIds: ambiguous.map((c) => c.id),
              });
            }
          }
          const ffdSynced = await tx.competition.findFirst({
            where: {
              ...organizedByClubOrLabel({ id: clubId, name: current.name }),
              ffdId: { not: null },
            },
            select: idOnlySelect,
          });
          if (ffdSynced) {
            throw new ConflictException({ message: FFD_SYNCED_NAME });
          }
          // Excludes the club itself so a case-only rename is allowed.
          const clash = await tx.club.findFirst({
            where: { name: sameClubName(newName), id: { not: clubId } },
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
              OR: [
                { clubId },
                { clubId: null, clubName: sameClubName(current.name) },
              ],
            },
            data: { clubName: newName },
          });
          await tx.license.updateMany({
            where: { clubName: sameClubName(current.name) },
            data: { clubName: newName },
          });
          // Display label only: linked rows resolve the club by id (#408).
          await tx.competition.updateMany({
            where: { organizerClubId: clubId },
            data: { organizer: newName },
          });
          // Unlinked rows of the old name: linked explicitly, and only when
          // the name was unambiguous — a homonym's ambiguous competition is
          // never attached to this club (rights, HelloAsso payments).
          if (ownsUnlinkedByName) {
            await tx.competition.updateMany({
              where: {
                organizerClubId: null,
                organizer: sameClubName(current.name),
              },
              data: { organizer: newName, organizerClubId: clubId },
            });
          }
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
      if (!active) assertClubNotStoreReview(current, "disable");
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
        select: adminClubDeletionTargetSelect,
      });
      if (!club) throw new NotFoundException("Club introuvable");
      assertClubNotStoreReview(club, "delete");
      // Serialises against a concurrent attach (member, account) to this club.
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "Club" WHERE id = ${clubId} FOR UPDATE`,
      );
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
