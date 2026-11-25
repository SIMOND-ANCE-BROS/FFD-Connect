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
import { Prisma, UserRole } from "@prisma/client";
import { User } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { extractBirthDateFromLicenseNumber } from "../common/birth-date/license-birth-date.util";
import { normalizeDiscipline } from "../common/competition-level/competition-level.util";
import {
  BETA_AUTO_LICENSE_CLUB_NAME,
  BETA_LICENSE_PLACEHOLDER_CATEGORY,
} from "../licenses/beta-license-placeholder";
import { isLicenseExpired } from "../licenses/license-expiry";
import { normalizeLicenseNumber } from "../licenses/license-number.util";
import { linkUnclaimedLicence } from "../licenses/license-relink";
import { PrismaService } from "../prisma/prisma.service";
import {
  accountStatusSelect,
  erasedResultIdentitySelect,
  idOnlySelect,
  licenseClaimSelect,
  licenseIdSelect,
} from "../utils/prisma-selects";
import {
  erasedLicenceFingerprint,
  resultsPseudonymisationKey,
} from "../utils/results-pseudonym";
import {
  ACCOUNT_DISABLED_MESSAGE,
  AccountStatusFields,
  accountBlockReason,
} from "./account-status";
import { AuthTokenService } from "./auth-token.service";
import {
  findUserIdByEmail,
  isEmailTaken,
  normalizeEmail,
  storedEmailData,
} from "./email-identity";
import { LICENSE_NUMBER_MAX_LENGTH } from "./dto/register.dto";
import { hashToken } from "../utils/token-hash.util";
import { PasswordValidator } from "./password-validator";
import { IMPERSONATION_TOKEN_EXPIRY_MINUTES } from "./impersonation-session";
import { hasRole, rolesOf } from "./roles";
import { PRIVACY_POLICY_VERSION } from "../privacy-policy/privacy-policy-version";

const BCRYPT_ROUNDS = 12;

/**
 * Licenses auto-created under BETA_AUTO_LICENSE (staging only) carry the same
 * placeholders as scripts/seed-beta-testers.ts (see beta-license-placeholder):
 * an unknown discipline — never "Ten Dance" (#555) — and a visible fake club.
 */
const BETA_AUTO_LICENSE_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Registration refused because the licence cannot be claimed (409): linked to
 * an account, or released by an account since deleted (#897). ONE answer for
 * both, so a registration attempt never reveals that a licensee deleted their
 * account; the reason is only logged, by licence id. Step 2 (#987) adds a
 * verified recourse for a released licence; until then, support.
 */
export const LICENCE_NOT_CLAIMABLE_MESSAGE =
  "Cette licence ne peut pas être rattachée à un nouveau compte. Contactez le support.";

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    roles: UserRole[];
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

  /**
   * A licence was held by an account since deleted (#897): marked at the
   * deletion (`releasedAt`, since #897), or — for deletions before it — its
   * number's keyed fingerprint is in `ErasedResultIdentity` (#652, written
   * only when the pseudonymisation key is configured). Never true for a
   * licence no account ever held (federation import, staging seeds).
   */
  private async isReleasedLicence(licence: {
    number: string;
    releasedAt: Date | null;
  }): Promise<boolean> {
    if (licence.releasedAt) return true;
    const key = resultsPseudonymisationKey(this.configService);
    const number = normalizeLicenseNumber(licence.number);
    if (!key || !number) return false;
    const erased = await this.prisma.erasedResultIdentity.findUnique({
      where: { fingerprint: erasedLicenceFingerprint(key, number) },
      select: erasedResultIdentitySelect,
    });
    return erased !== null;
  }

  /**
   * 409 with the single "not claimable" answer (#897). The reason (linked /
   * released) only goes to the log, with the licence id: never the number,
   * which identifies a person (RGPD, #529).
   */
  private refuseUnclaimableLicence(
    licenceId: string | null,
    reason: "linked" | "released",
  ): never {
    this.logger.warn(
      { licenceId, reason },
      "Registration refused: licence not claimable",
    );
    throw new ConflictException(LICENCE_NOT_CLAIMABLE_MESSAGE);
  }

  /** Staging-only escape hatch: strictly "true" enables it, anything else off. */
  private isBetaAutoLicenseEnabled(): boolean {
    return this.configService.get<string>("BETA_AUTO_LICENSE") === "true";
  }

  async validateUser(
    email: string,
    pass: string,
  ): Promise<
    (Omit<User, "password"> & { verifiedPasswordHashes: string[] }) | null
  > {
    const fullSelect = {
      ...accountStatusSelect,
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

    // Case / spaces of the typed address do not matter (#465).
    const userId = await findUserIdByEmail(this.prisma, email);
    if (!userId) return null;

    let user:
      | (AccountStatusFields & { password: string; [k: string]: unknown })
      | null = null;
    try {
      user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: fullSelect,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.message.includes("does not exist") || err.code === "P2021")
      ) {
        // Base ou schéma pas à jour : requête minimale (colonnes historiques)
        user = await this.prisma.user.findUnique({
          where: { id: userId },
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
      // Status only after the password: a stranger learns nothing about the
      // account, its owner learns why they cannot get in.
      if (accountBlockReason(user)) {
        throw new ForbiddenException(ACCOUNT_DISABLED_MESSAGE);
      }
      // Fingerprints of the hash(es) this password was verified against: the
      // refresh token insert (login) re-reads the hash under the user lock
      // and refuses if a reset replaced it meanwhile (#886). No clock involved.
      const verifiedPasswordHashes = [hashToken(user.password)];
      // Rehash silencieux si le hash existant a été généré avec < 12 rounds
      const currentRounds = bcrypt.getRounds(user.password);
      if (currentRounds < BCRYPT_ROUNDS) {
        const oldHash = user.password;
        try {
          const newHash = await bcrypt.hash(pass, BCRYPT_ROUNDS);
          // The upgraded hash is the same password: login accepts it too.
          verifiedPasswordHashes.push(hashToken(newHash));
          // Only while the stored hash is still the one verified: a password
          // reset that committed meanwhile must never be overwritten by the
          // rehash of the old password.
          this.prisma.user
            .updateMany({
              where: { id: user.id as string, password: oldHash },
              data: { password: newHash },
            })
            .catch((err: unknown) => {
              this.logger.warn(
                { err, userId: user.id },
                "Silent bcrypt rehash failed — login not affected",
              );
            });
        } catch (err) {
          this.logger.warn(
            { err, userId: user.id },
            "Silent bcrypt rehash failed — login not affected",
          );
        }
      }
      // `club` (status only) stays on the result: login() needs it so rolesOf
      // drops an extra CLUB role of a disabled club. login() builds its
      // response field by field, so it does not reach the client.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password, ...result } = user;
      return { ...result, verifiedPasswordHashes } as Omit<User, "password"> & {
        verifiedPasswordHashes: string[];
      };
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
    const normalizedEmail = normalizeEmail(email);

    // 3. Check email not already taken, whatever its casing (#465)
    if (await isEmailTaken(this.prisma, normalizedEmail)) {
      throw new ConflictException("Un compte existe déjà avec cet email");
    }

    // 4. Find license by number (must exist and be unclaimed)
    const trimmedLicenseNumber = licenseNumber.trim();
    const existingLicense = await this.prisma.license.findUnique({
      where: { number: trimmedLicenseNumber },
      select: licenseClaimSelect,
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
      category: BETA_LICENSE_PLACEHOLDER_CATEGORY,
      clubName: BETA_AUTO_LICENSE_CLUB_NAME,
      userId: null,
      releasedAt: null,
    };

    // 5. Check license not already linked to an account, nor released by an
    // account since deleted (#897): its number alone no longer links it. A
    // licence to auto-create (id === null) was never held: unchanged.
    if (license.userId) {
      this.refuseUnclaimableLicence(license.id, "linked");
    }
    if (license.id !== null && (await this.isReleasedLicence(license))) {
      this.refuseUnclaimableLicence(license.id, "released");
    }

    // 6. Check license validity (valid through its whole Paris day, #384)
    if (isLicenseExpired(license.validUntil)) {
      throw new BadRequestException(
        "Cette licence a expiré. Contactez votre club pour le renouvellement.",
      );
    }

    // 7. Hash password
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    // 7b. Derive the birth date from the federal licence number (#60). The
    // number is the authoritative source — it comes from the FFD, not from the
    // registrant. When it does not encode a usable date the column stays null,
    // which means "unknown" and must never be read as "of age" (see #61 / #23).
    const birthDate = extractBirthDateFromLicenseNumber(license.number);

    // 8. Create user + link license in a transaction
    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.user
        .create({
          data: {
            ...storedEmailData(normalizedEmail),
            password: hashedPassword,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            role: "LICENSEE",
            clubName: license.clubName,
            // Declared discipline only when the licence carries a real one:
            // a placeholder (beta licences) or unknown value leaves the profile
            // empty (= unknown) rather than declaring "Ten Dance" (#555).
            category: normalizeDiscipline(license.category),
            birthDate,
            // Signs up under the current policy (linked from the sign-up
            // form): no "policy updated" notice right after (#734).
            privacyPolicySeenVersion: PRIVACY_POLICY_VERSION,
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
        })
        .catch((err: unknown) => {
          // Lost the race to a concurrent registration of the same address:
          // every write stores the normalised form, so the unique index on
          // `email` catches any casing (#465). Same answer as the pre-check.
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
          ) {
            throw new ConflictException("Un compte existe déjà avec cet email");
          }
          throw err;
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
            throw new ConflictException(LICENCE_NOT_CLAIMABLE_MESSAGE);
          }
          throw err;
        }
      } else {
        // New licence id (#881): QR codes issued to a previous holder of this
        // licence (account deleted, link set to null) never designate the
        // new account. Conditional on the licence being still unclaimed.
        if (!(await linkUnclaimedLicence(tx, license.id, newUser.id))) {
          throw new ConflictException(LICENCE_NOT_CLAIMABLE_MESSAGE);
        }
      }

      return { ...newUser, license: { number: license.number } };
    });

    if (license.id === null) {
      // The account id, never the licence number: it identifies a person
      // and the FFD publishes it next to their name (RGPD, #529).
      this.logger.log(
        { userId: user.id },
        "Beta license auto-created during registration (BETA_AUTO_LICENSE)",
      );
    }

    this.logger.log(
      // The birth date is personal data and so is the licence number, which
      // encodes it (RGPD, #529): only the account id and whether the date
      // could be derived are logged.
      {
        userId: user.id,
        birthDateResolved: birthDate !== null,
      },
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
      extraRoles?: UserRole[];
      club?: { disabledAt: Date | null } | null;
      /** From validateUser; see AuthTokenService.createRefreshToken (#886). */
      verifiedPasswordHashes?: string[];
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

    // First: a login refused as stale (password reset meanwhile, #886) must
    // not count as a login (inactivity warning #991, invitation resend).
    const refreshToken = await this.authTokenService.createRefreshToken(
      user.id,
      user.verifiedPasswordHashes,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      select: { id: true },
    });

    return {
      access_token,
      refresh_token: refreshToken.token,
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

  /**
   * Impersonation « se connecter en tant que » (#545). Émet un access token
   * court dont le `sub` = cible, un claim `impersonatedBy` = acteur et un claim
   * `impersonationLogId` = la ligne du journal de cette session (#733), relue
   * à chaque requête. Journalise l'accès (audit RGPD). PAS de refresh token
   * (session courte, il faut ré-impersonner).
   *
   * Règles (#733) : réservé à l'ADMIN (rôle principal ou supplémentaire, relu
   * en base par JwtStrategy) ; on ne peut jamais impersonner un ADMIN ; un
   * licencié, un club ou un staff peut être ciblé.
   */
  async impersonate(
    actorId: string,
    actorRoles: readonly UserRole[],
    target: { userId?: string; email?: string },
    reason: string | undefined,
    ip: string | undefined,
  ): Promise<{ access_token: string; user: Record<string, unknown> }> {
    if (!actorRoles.includes(UserRole.ADMIN)) {
      throw new ForbiddenException(
        "Impersonation réservée à l'administrateur.",
      );
    }
    if (!target.userId && !target.email) {
      throw new BadRequestException("Cible manquante (userId ou email).");
    }

    const targetUserId =
      target.userId || (await findUserIdByEmail(this.prisma, target.email!));
    const targetUser = targetUserId
      ? await this.prisma.user.findUnique({
          where: { id: targetUserId },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            clubId: true,
            clubName: true,
            ...accountStatusSelect, // includes role
          },
        })
      : null;
    if (!targetUser) {
      throw new NotFoundException("Utilisateur cible introuvable.");
    }
    if (accountBlockReason(targetUser)) {
      throw new ForbiddenException("Ce compte est désactivé.");
    }
    if (actorId === targetUser.id) {
      throw new BadRequestException("Impossible de s'impersonner soi-même.");
    }
    if (hasRole(targetUser, UserRole.ADMIN)) {
      throw new ForbiddenException(
        "Impossible d'impersonner un administrateur.",
      );
    }

    const log = await this.prisma.impersonationLog.create({
      data: {
        actorId,
        // The role that authorised this impersonation, not the main role:
        // only ADMIN can (#733), whatever the actor's main role.
        actorRole: UserRole.ADMIN,
        targetUserId: targetUser.id,
        targetRole: targetUser.role,
        reason: reason?.trim() || null,
        ip: ip ?? null,
      },
      select: idOnlySelect,
    });

    const payload = {
      email: targetUser.email,
      sub: targetUser.id,
      role: targetUser.role,
      clubName: targetUser.clubName ?? undefined,
      impersonatedBy: actorId,
      impersonationLogId: log.id,
    };
    const access_token = this.jwtService.sign(payload, {
      expiresIn: `${IMPERSONATION_TOKEN_EXPIRY_MINUTES}m`,
    });

    this.logger.warn(
      `Impersonation START — actor=${actorId} (${actorRoles.join("+")}) → target=${targetUser.id} (${targetUser.role})`,
    );

    return {
      access_token,
      user: {
        id: targetUser.id,
        email: targetUser.email,
        firstName: targetUser.firstName,
        lastName: targetUser.lastName,
        role: targetUser.role,
        roles: rolesOf(targetUser),
        clubId: targetUser.clubId,
        clubName: targetUser.clubName,
      },
    };
  }

  /**
   * Clôt la session d'impersonation désignée par le jeton (#733) : la ligne
   * du journal portée par le claim `impersonationLogId`, et elle seule (une
   * autre session ouverte du même acteur, sur un autre appareil, reste
   * ouverte). Sans ce claim — appel hors impersonation —, rien à clore. Une
   * session jamais arrêtée prend fin à l'expiration de son jeton
   * (`effectiveImpersonationEnd`).
   */
  async stopImpersonation(
    actorId: string,
    impersonationLogId: string | undefined,
  ): Promise<void> {
    if (!impersonationLogId) return;
    const { count } = await this.prisma.impersonationLog.updateMany({
      where: { id: impersonationLogId, actorId, endedAt: null },
      data: { endedAt: new Date() },
    });
    if (count > 0) {
      this.logger.warn(
        `Impersonation STOP — actor=${actorId} log=${impersonationLogId}`,
      );
    }
  }
}
