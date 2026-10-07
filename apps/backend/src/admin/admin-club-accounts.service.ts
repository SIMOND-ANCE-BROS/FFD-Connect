import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, UserRole } from "@prisma/client";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import { AuthPasswordService } from "../auth/auth-password.service";
import { EmailService } from "../auth/email.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  adminClubOptionSelect,
  adminInvitationTargetSelect,
} from "../utils/prisma-selects";
import { AdminAuditService } from "./admin-audit.service";
import {
  ClubAccountCreatedDto,
  CreateClubAccountDto,
  InvitationResultDto,
} from "./dto/club-account.dto";

export const INVITATION_EXPIRY_HOURS = 168;
const BCRYPT_ROUNDS = 12;

/** Club accounts created by an admin; the manager sets the password by email. */
@Injectable()
export class AdminClubAccountsService {
  private readonly logger = new Logger(AdminClubAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly passwords: AuthPasswordService,
    private readonly email: EmailService,
  ) {}

  async create(
    actorId: string,
    dto: CreateClubAccountDto,
  ): Promise<ClubAccountCreatedDto> {
    if (Boolean(dto.clubId) === Boolean(dto.clubName)) {
      throw new BadRequestException(
        "Indiquer soit un club existant, soit le nom d'un nouveau club",
      );
    }
    const email = dto.email.trim().toLowerCase();
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    // Unusable secret: the manager sets the real password via the invitation.
    const password = await bcrypt.hash(
      crypto.randomBytes(32).toString("hex"),
      BCRYPT_ROUNDS,
    );

    let created: { userId: string; club: { id: string; name: string } };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const taken = await tx.user.findUnique({
          where: { email },
          select: { id: true },
        });
        if (taken) throw new ConflictException("Cet email est déjà utilisé");

        let club: { id: string; name: string };
        if (dto.clubId) {
          const existing = await tx.club.findUnique({
            where: { id: dto.clubId },
            select: adminClubOptionSelect,
          });
          if (!existing) throw new BadRequestException("Club introuvable");
          club = existing;
        } else {
          const name = (dto.clubName ?? "").trim();
          const existing = await tx.club.findUnique({
            where: { name },
            select: adminClubOptionSelect,
          });
          if (existing) {
            throw new ConflictException({
              message: "Un club porte déjà ce nom",
              existingClubId: existing.id,
            });
          }
          club = await tx.club.create({
            data: { name },
            select: adminClubOptionSelect,
          });
        }

        const user = await tx.user.create({
          data: {
            email,
            password,
            firstName,
            lastName,
            role: UserRole.CLUB,
            clubId: club.id,
            clubName: club.name,
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          actorId,
          action: "CLUB_ACCOUNT_CREATE",
          targetType: "USER",
          targetId: user.id,
          after: {
            email,
            clubId: club.id,
            clubName: club.name,
            role: UserRole.CLUB,
          },
        });
        return { userId: user.id, club };
      });
    } catch (err) {
      throw await this.mapUniqueViolation(err, dto);
    }
    const { userId, club } = created;

    const invitationSent = await this.sendInvitation(userId, email, firstName);
    return { userId, clubId: club.id, invitationSent };
  }

  async resendInvitation(
    actorId: string,
    userId: string,
  ): Promise<InvitationResultDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: adminInvitationTargetSelect,
    });
    if (!user) throw new NotFoundException("Utilisateur introuvable");
    if (user.lastLoginAt) {
      throw new BadRequestException("Ce compte s'est déjà connecté");
    }
    await this.prisma.$transaction(async (tx) => {
      await this.audit.record(tx, {
        actorId,
        action: "INVITATION_RESEND",
        targetType: "USER",
        targetId: user.id,
      });
    });
    const invitationSent = await this.sendInvitation(
      user.id,
      user.email,
      user.firstName,
    );
    return { invitationSent };
  }

  /**
   * Lost a race against a concurrent create: the pre-checks passed but the
   * unique constraint fired. Surface it as the same 409 the checks produce.
   */
  private async mapUniqueViolation(
    err: unknown,
    dto: CreateClubAccountDto,
  ): Promise<unknown> {
    if (
      !(err instanceof Prisma.PrismaClientKnownRequestError) ||
      err.code !== "P2002"
    ) {
      return err;
    }
    const target = JSON.stringify(err.meta?.target ?? "").toLowerCase();
    if (target.includes("email")) {
      return new ConflictException("Cet email est déjà utilisé");
    }
    if (dto.clubName && target.includes("name")) {
      const existing = await this.prisma.club.findUnique({
        where: { name: dto.clubName.trim() },
        select: adminClubOptionSelect,
      });
      return new ConflictException({
        message: "Un club porte déjà ce nom",
        ...(existing ? { existingClubId: existing.id } : {}),
      });
    }
    return err;
  }

  /** Graceful degradation: a mail failure never rolls back the account. */
  private async sendInvitation(
    userId: string,
    email: string,
    firstName: string,
  ): Promise<boolean> {
    try {
      const token = await this.passwords.issuePasswordToken(
        userId,
        INVITATION_EXPIRY_HOURS,
      );
      await this.email.sendInvitationEmail(email, token, firstName);
      return true;
    } catch (error) {
      this.logger.warn(
        `Club invitation not sent for user ${userId}: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
