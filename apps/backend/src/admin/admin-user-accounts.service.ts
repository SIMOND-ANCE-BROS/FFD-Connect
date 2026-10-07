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
import { EmailService, InvitationRole } from "../auth/email.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  adminClubOptionSelect,
  adminInvitationTargetSelect,
} from "../utils/prisma-selects";
import { AdminAuditService } from "./admin-audit.service";
import {
  AdminUserCreatedDto,
  CreateAdminUserDto,
  InvitationResultDto,
} from "./dto/admin-user-accounts.dto";

export const INVITATION_EXPIRY_HOURS = 168;
const BCRYPT_ROUNDS = 12;

/** Profile fields the admin filled; null and absent both mean "not set". */
function profileOf(dto: CreateAdminUserDto) {
  return {
    category: dto.category ?? undefined,
    ageGroup: dto.ageGroup ?? undefined,
    passportLevelLatin: dto.passportLevelLatin ?? undefined,
    passportLevelStandard: dto.passportLevelStandard ?? undefined,
    competitionLevel: dto.competitionLevel ?? undefined,
    nationalRanking: dto.nationalRanking ?? undefined,
  };
}

const definedOnly = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Accounts created by an admin; the person sets the password by email. */
@Injectable()
export class AdminUserAccountsService {
  private readonly logger = new Logger(AdminUserAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly passwords: AuthPasswordService,
    private readonly email: EmailService,
  ) {}

  async create(
    actorId: string,
    dto: CreateAdminUserDto,
  ): Promise<AdminUserCreatedDto> {
    this.checkClubChoice(dto);
    const email = dto.email.trim().toLowerCase();
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const profile = profileOf(dto);
    // Unusable secret: the person sets the real password via the invitation.
    const password = await bcrypt.hash(
      crypto.randomBytes(32).toString("hex"),
      BCRYPT_ROUNDS,
    );

    let created: {
      userId: string;
      club: { id: string; name: string } | null;
    };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const taken = await tx.user.findUnique({
          where: { email },
          select: { id: true },
        });
        if (taken) throw new ConflictException("Cet email est déjà utilisé");

        const club = await this.resolveClub(tx, dto);
        const user = await tx.user.create({
          data: {
            email,
            password,
            firstName,
            lastName,
            role: dto.role,
            clubId: club?.id ?? null,
            clubName: club?.name ?? null,
            ...profile,
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          actorId,
          action: "USER_CREATE",
          targetType: "USER",
          targetId: user.id,
          after: {
            email,
            role: dto.role,
            ...(club && { clubId: club.id, clubName: club.name }),
            ...definedOnly(profile),
          },
        });
        return { userId: user.id, club };
      });
    } catch (err) {
      throw await this.mapUniqueViolation(err, dto);
    }

    const invitationSent = await this.sendInvitation(
      created.userId,
      email,
      firstName,
      dto.role,
    );
    return {
      userId: created.userId,
      clubId: created.club?.id ?? null,
      invitationSent,
    };
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
    if (user.role === UserRole.ADMIN) {
      throw new BadRequestException(
        "Un compte administrateur ne reçoit pas d'invitation",
      );
    }
    if (user.lastLoginAt) {
      throw new BadRequestException("Ce compte s'est déjà connecté");
    }
    if (user.disabledAt) {
      throw new BadRequestException("Ce compte est désactivé");
    }
    const role: InvitationRole = user.role;
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
      role,
    );
    return { invitationSent };
  }

  /** A new club only for a CLUB account; a CLUB account always has a club. */
  private checkClubChoice(dto: CreateAdminUserDto): void {
    if (dto.clubId && dto.clubName) {
      throw new BadRequestException(
        "Indiquer soit un club existant, soit le nom d'un nouveau club",
      );
    }
    if (dto.clubName && dto.role !== UserRole.CLUB) {
      throw new BadRequestException(
        "Seul un compte Club peut créer un nouveau club",
      );
    }
    if (dto.role === UserRole.CLUB && !dto.clubId && !dto.clubName) {
      throw new BadRequestException(
        "Un compte Club doit être rattaché à un club",
      );
    }
  }

  private async resolveClub(
    tx: Prisma.TransactionClient,
    dto: CreateAdminUserDto,
  ): Promise<{ id: string; name: string } | null> {
    if (dto.clubId) {
      const existing = await tx.club.findUnique({
        where: { id: dto.clubId },
        select: adminClubOptionSelect,
      });
      if (!existing) throw new BadRequestException("Club introuvable");
      return existing;
    }
    if (!dto.clubName) return null;
    const name = dto.clubName.trim();
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
    return tx.club.create({ data: { name }, select: adminClubOptionSelect });
  }

  /**
   * Lost a race against a concurrent create: the pre-checks passed but the
   * unique constraint fired. Surface it as the same 409 the checks produce.
   */
  private async mapUniqueViolation(
    err: unknown,
    dto: CreateAdminUserDto,
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
    role: InvitationRole,
  ): Promise<boolean> {
    try {
      const token = await this.passwords.issuePasswordToken(
        userId,
        INVITATION_EXPIRY_HOURS,
      );
      await this.email.sendInvitationEmail(email, token, firstName, role);
      return true;
    } catch (error) {
      this.logger.warn(
        `Invitation not sent for user ${userId}: ${(error as Error).message}`,
      );
      return false;
    }
  }
}
