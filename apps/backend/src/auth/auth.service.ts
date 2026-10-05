import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "@prisma/client";
import { User } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";
import { licenseIdSelect } from "../utils/prisma-selects";
import { AuthTokenService } from "./auth-token.service";
import { LICENSE_NUMBER_MAX_LENGTH } from "./dto/register.dto";
import { PasswordValidator } from "./password-validator";

const BCRYPT_ROUNDS = 12;

/**
 * Placeholders for licenses auto-created under BETA_AUTO_LICENSE (staging only).
 * Category mirrors the default used by scripts/seed-beta-testers.ts; the club
 * name is deliberately a visible placeholder rather than a real club.
 */
const BETA_AUTO_LICENSE_CATEGORY = "Ten Dance";
const BETA_AUTO_LICENSE_CLUB_NAME = "Club bêta-test (licence auto-créée)";
const BETA_AUTO_LICENSE_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    clubId?: string | null;
    clubName: string | null;
    licenseNumber?: string | null;
    category?: string | null;
    ageGroup?: string | null;
    passportLevelLatin?: string | null;
    passportLevelStandard?: string | null;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly ACCESS_TOKEN_EXPIRY_MINUTES = 60;

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private authTokenService: AuthTokenService,
    private configService: ConfigService,
  ) {}

  /** Staging-only escape hatch: strictly "true" enables it, anything else off. */
  private isBetaAutoLicenseEnabled(): boolean {
    return this.configService.get<string>("BETA_AUTO_LICENSE") === "true";
  }

  async validateUser(
    email: string,
    pass: string,
  ): Promise<Omit<User, "password"> | null> {
    const fullSelect = {
      id: true,
      email: true,
      password: true,
      firstName: true,
      lastName: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      ageGroup: true,
      category: true,
      clubId: true,
      clubName: true,
      birthDate: true,
      nationalRanking: true,
      passportLevelLatin: true,
      passportLevelStandard: true,
      competitionLevel: true,
      license: {
        select: {
          id: true,
          number: true,
          validUntil: true,
          category: true,
          clubName: true,
          qrCodeSignature: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    } as const;

    let user: { password: string; [k: string]: unknown } | null = null;
    try {
      user = await this.prisma.user.findUnique({
        where: { email },
        select: fullSelect,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.message.includes("does not exist") || err.code === "P2021")
      ) {
        // Base ou schéma pas à jour : requête minimale (colonnes historiques)
        user = await this.prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            password: true,
            firstName: true,
            lastName: true,
            role: true,
            createdAt: true,
            updatedAt: true,
            ageGroup: true,
            category: true,
            clubName: true,
          },
        });
      } else {
        throw err;
      }
    }

    if (user && (await bcrypt.compare(pass, user.password))) {
      // Rehash silencieux si le hash existant a été généré avec < 12 rounds
      const currentRounds = bcrypt.getRounds(user.password);
      if (currentRounds < BCRYPT_ROUNDS) {
        bcrypt
          .hash(pass, BCRYPT_ROUNDS)
          .then((newHash) =>
            this.prisma.user.update({
              where: { id: user.id as string },
              data: { password: newHash },
            }),
          )
          .catch((err: unknown) => {
            this.logger.warn(
              { err, userId: user.id },
              "Silent bcrypt rehash failed — login not affected",
            );
          });
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password, ...result } = user;
      return result as Omit<User, "password">;
    }
    return null;
  }

  async register(
    email: string,
    password: string,
    licenseNumber: string,
    lastName: string,
    firstName = "",
  ): Promise<LoginResponse> {
    // 1. Validate password policy
    const passwordCheck = PasswordValidator.validate(password);
    if (!passwordCheck.isValid) {
      throw new BadRequestException({
        message: "Le mot de passe ne respecte pas la politique de sécurité",
        errors: passwordCheck.errors,
      });
    }

    // 2. Normalize email
    const normalizedEmail = email.trim().toLowerCase();

    // 3. Check email not already taken
    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existingUser) {
      throw new ConflictException("Un compte existe déjà avec cet email");
    }

    // 4. Find license by number (must exist and be unclaimed)
    const trimmedLicenseNumber = licenseNumber.trim();
    const existingLicense = await this.prisma.license.findUnique({
      where: { number: trimmedLicenseNumber },
      select: {
        id: true,
        number: true,
        validUntil: true,
        category: true,
        clubName: true,
        userId: true,
      },
    });

    // Staging only (BETA_AUTO_LICENSE=true): an unknown number is auto-created
    // inside the registration transaction below instead of being rejected.
    if (!existingLicense) {
      if (!this.isBetaAutoLicenseEnabled()) {
        throw new NotFoundException(
          "Aucune licence trouvée avec ce numéro. Vérifiez votre numéro de licence FFD.",
        );
      }
      if (
        trimmedLicenseNumber.length === 0 ||
        trimmedLicenseNumber.length > LICENSE_NUMBER_MAX_LENGTH
      ) {
        throw new BadRequestException("Numéro de licence invalide.");
      }
    }

    // id === null marks a license to auto-create (only reachable with the flag on).
    const license = existingLicense ?? {
      id: null,
      number: trimmedLicenseNumber,
      validUntil: new Date(Date.now() + BETA_AUTO_LICENSE_VALIDITY_MS),
      category: BETA_AUTO_LICENSE_CATEGORY,
      clubName: BETA_AUTO_LICENSE_CLUB_NAME,
      userId: null,
    };

    // 5. Check license not already linked to an account
    if (license.userId) {
      throw new ConflictException(
        "Cette licence est déjà associée à un compte",
      );
    }

    // 6. Check license validity
    if (license.validUntil < new Date()) {
      throw new BadRequestException(
        "Cette licence a expiré. Contactez votre club pour le renouvellement.",
      );
    }

    // 7. Hash password
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // 8. Create user + link license in a transaction
    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          email: normalizedEmail,
          password: hashedPassword,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          role: "LICENSEE",
          clubName: license.clubName,
          category: license.category,
        },
        select: {
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
        },
      });

      if (license.id === null) {
        try {
          await tx.license.create({
            data: {
              number: license.number,
              validUntil: license.validUntil,
              category: license.category,
              clubName: license.clubName,
              userId: newUser.id,
            },
            select: licenseIdSelect,
          });
        } catch (err) {
          // Lost the race: a concurrent registration created this number first.
          // Throwing inside the callback rolls the user creation back too.
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
          ) {
            throw new ConflictException(
              "Cette licence est déjà associée à un compte",
            );
          }
          throw err;
        }
      } else {
        await tx.license.update({
          where: { id: license.id },
          data: { userId: newUser.id },
        });
      }

      return { ...newUser, license: { number: license.number } };
    });

    if (license.id === null) {
      this.logger.log(
        { licenseNumber: license.number },
        "Beta license auto-created during registration (BETA_AUTO_LICENSE)",
      );
    }

    this.logger.log(
      { userId: user.id, licenseNumber: license.number },
      "New user registered via license verification",
    );

    // 9. Generate tokens and return
    return this.login(
      user as Omit<User, "password"> & { license: { number: string } },
    );
  }

  async login(
    user: Omit<User, "password"> & {
      license?: { number: string | null } | null;
    },
  ): Promise<LoginResponse> {
    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
      clubName: user.clubName,
    };

    const access_token = this.jwtService.sign(payload, {
      expiresIn: `${this.ACCESS_TOKEN_EXPIRY_MINUTES}m`,
    });

    const refreshToken = await this.authTokenService.createRefreshToken(
      user.id,
    );

    return {
      access_token,
      refresh_token: refreshToken.token,
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

  /** Durée d'un token d'impersonation (court, non rafraîchissable). */
  private readonly IMPERSONATION_TOKEN_EXPIRY_MINUTES = 15;

  /**
   * Impersonation « se connecter en tant que » (#545). Émet un access token
   * court dont le `sub` = cible et un claim `impersonatedBy` = acteur (tracé
   * dans chaque requête). Journalise l'accès (audit RGPD). PAS de refresh token
   * (session courte, il faut ré-impersonner).
   *
   * Règles : l'acteur doit être ADMIN ou STAFF ; on ne peut jamais impersonner
   * un ADMIN ; un STAFF ne peut cibler que licencié/club et doit fournir une
   * raison (consentement géré côté flux, phase 2).
   */
  async impersonate(
    actorId: string,
    actorRole: string,
    target: { userId?: string; email?: string },
    reason: string | undefined,
    ip: string | undefined,
  ): Promise<{ access_token: string; user: Record<string, unknown> }> {
    if (actorRole !== "ADMIN" && actorRole !== "STAFF") {
      throw new ForbiddenException("Impersonation réservée à l'admin/staff.");
    }
    if (!target.userId && !target.email) {
      throw new BadRequestException("Cible manquante (userId ou email).");
    }

    const targetUser = await this.prisma.user.findUnique({
      where: target.userId
        ? { id: target.userId }
        : { email: target.email!.trim().toLowerCase() },
      select: {
        id: true,
        email: true,
        role: true,
        firstName: true,
        lastName: true,
        clubId: true,
        clubName: true,
      },
    });
    if (!targetUser) {
      throw new NotFoundException("Utilisateur cible introuvable.");
    }
    if (actorId === targetUser.id) {
      throw new BadRequestException("Impossible de s'impersonner soi-même.");
    }
    if (targetUser.role === "ADMIN") {
      throw new ForbiddenException(
        "Impossible d'impersonner un administrateur.",
      );
    }
    if (actorRole === "STAFF") {
      if (targetUser.role === "STAFF") {
        throw new ForbiddenException(
          "Un staff ne peut cibler qu'un licencié ou un club.",
        );
      }
      if (!reason?.trim()) {
        throw new BadRequestException(
          "Une raison est obligatoire pour le staff.",
        );
      }
    }

    // Rôle de l'acteur lu en base (typé UserRole, autoritaire — pas la string
    // du JWT) pour le journal d'audit.
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { role: true },
    });
    if (!actor) {
      throw new NotFoundException("Acteur introuvable.");
    }

    await this.prisma.impersonationLog.create({
      data: {
        actorId,
        actorRole: actor.role,
        targetUserId: targetUser.id,
        targetRole: targetUser.role,
        reason: reason?.trim() || null,
        ip: ip ?? null,
      },
    });

    const payload = {
      email: targetUser.email,
      sub: targetUser.id,
      role: targetUser.role,
      clubName: targetUser.clubName ?? undefined,
      impersonatedBy: actorId,
    };
    const access_token = this.jwtService.sign(payload, {
      expiresIn: `${this.IMPERSONATION_TOKEN_EXPIRY_MINUTES}m`,
    });

    this.logger.warn(
      `Impersonation START — actor=${actorId} (${actorRole}) → target=${targetUser.id} (${targetUser.role})`,
    );

    return {
      access_token,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        firstName: targetUser.firstName,
        lastName: targetUser.lastName,
        role: targetUser.role,
        clubId: targetUser.clubId,
        clubName: targetUser.clubName,
      },
    };
  }

  /** Clôt la session d'impersonation ouverte la plus récente de l'acteur. */
  async stopImpersonation(actorId: string): Promise<void> {
    const open = await this.prisma.impersonationLog.findFirst({
      where: { actorId, endedAt: null },
      orderBy: { startedAt: "desc" },
      select: { id: true },
    });
    if (open) {
      await this.prisma.impersonationLog.update({
        where: { id: open.id },
        data: { endedAt: new Date() },
      });
      this.logger.warn(`Impersonation STOP — actor=${actorId}`);
    }
  }
}
