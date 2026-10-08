import { createHash, randomBytes } from "crypto";
import {
  GoneException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  licenseWalletPassSelect,
  walletPassTokenSelect,
} from "../../utils/prisma-selects";
import { toLicenseQrExpiry } from "../qr/license-qr";
import { ApplePassLicense } from "./apple-wallet-pass";
import {
  APPLE_WALLET_UNAVAILABLE_MESSAGE,
  AppleWalletPassGenerator,
} from "./apple-wallet-pass.generator";

/** Lifetime of a download link (Safari opens it right away). */
export const WALLET_PASS_TOKEN_TTL_MS = 5 * 60 * 1000;

/** 32 random bytes, unpadded base64url. */
export const WALLET_PASS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const LICENSE_NOT_FOUND_MESSAGE = "Aucune licence pour ce compte";
export const LICENSE_EXPIRED_MESSAGE =
  "Licence expirée : renouvelez-la avant de l'ajouter à Apple Wallet";
export const TOKEN_INVALID_MESSAGE =
  "Lien de téléchargement invalide ou déjà utilisé";
export const TOKEN_EXPIRED_MESSAGE =
  "Lien de téléchargement expiré : relancez l'ajout depuis l'application";

export function hashWalletPassToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface IssuedWalletPassToken {
  /** Raw token — returned once, only its SHA-256 is stored. */
  token: string;
  expiresAt: Date;
}

/**
 * Apple Wallet license pass download flow (#162):
 * 1. the authenticated app asks for a short, single-use download token;
 * 2. Safari (no JWT) exchanges that token for the signed `.pkpass`.
 *
 * Tokens live in Postgres (hashed): unlike the Redis cache, which degrades to
 * "nothing stored" when unavailable, a one-shot token needs a deterministic
 * store with an atomic consume. No scheduled cleanup (scale-to-zero backend):
 * issuing a token deletes the user's previous ones, consuming deletes the row.
 */
@Injectable()
export class AppleWalletPassService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly generator: AppleWalletPassGenerator,
  ) {}

  isAvailable(): boolean {
    return this.generator.isAvailable();
  }

  private ensureAvailable(): void {
    if (!this.generator.isAvailable()) {
      throw new ServiceUnavailableException(APPLE_WALLET_UNAVAILABLE_MESSAGE);
    }
  }

  /** The user's license if it is still valid (end of its day in Paris). */
  private async loadActiveLicense(
    userId: string,
    now: Date,
  ): Promise<ApplePassLicense> {
    const license = await this.prisma.license.findUnique({
      where: { userId },
      select: licenseWalletPassSelect,
    });
    if (!license?.user) throw new NotFoundException(LICENSE_NOT_FOUND_MESSAGE);
    // Same rule as the signed QR: valid until the end of its day in Paris.
    if (toLicenseQrExpiry(now) > toLicenseQrExpiry(license.validUntil)) {
      throw new UnprocessableEntityException(LICENSE_EXPIRED_MESSAGE);
    }
    return {
      id: license.id,
      number: license.number,
      category: license.category,
      validUntil: license.validUntil,
      firstName: license.user.firstName,
      lastName: license.user.lastName,
    };
  }

  /** Step 1 — issues a download token for the caller's OWN license. */
  async issueDownloadToken(
    userId: string,
    now: Date = new Date(),
  ): Promise<IssuedWalletPassToken> {
    this.ensureAvailable();
    await this.loadActiveLicense(userId, now);

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + WALLET_PASS_TOKEN_TTL_MS);
    await this.prisma.$transaction([
      // At most one live token per user, and no table growth without a cron.
      this.prisma.walletPassDownloadToken.deleteMany({ where: { userId } }),
      this.prisma.walletPassDownloadToken.create({
        data: { tokenHash: hashWalletPassToken(token), userId, expiresAt },
        select: { id: true },
      }),
    ]);
    return { token, expiresAt };
  }

  /**
   * Step 2 — consumes the token (once) and returns the signed pass. The
   * feature check comes first so a disabled feature does not burn the token.
   */
  async consumeAndGeneratePass(
    token: string,
    now: Date = new Date(),
  ): Promise<Buffer> {
    this.ensureAvailable();
    if (!WALLET_PASS_TOKEN_PATTERN.test(token)) {
      throw new NotFoundException(TOKEN_INVALID_MESSAGE);
    }

    const tokenHash = hashWalletPassToken(token);
    const row = await this.prisma.walletPassDownloadToken.findUnique({
      where: { tokenHash },
      select: walletPassTokenSelect,
    });
    if (!row) throw new NotFoundException(TOKEN_INVALID_MESSAGE);

    // Atomic consume: of two concurrent requests, only one deletes the row.
    const { count } = await this.prisma.walletPassDownloadToken.deleteMany({
      where: { tokenHash },
    });
    if (count !== 1) throw new NotFoundException(TOKEN_INVALID_MESSAGE);

    if (row.expiresAt.getTime() <= now.getTime()) {
      throw new GoneException(TOKEN_EXPIRED_MESSAGE);
    }

    const license = await this.loadActiveLicense(row.userId, now);
    return this.generator.generate(license);
  }
}
