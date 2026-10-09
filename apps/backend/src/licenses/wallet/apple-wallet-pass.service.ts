import { randomBytes } from "crypto";
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
import { hashToken } from "../../utils/token-hash.util";
import { toLicenseQrExpiry } from "../qr/license-qr";
import { ApplePassLicense } from "./apple-wallet-pass";
import {
  APPLE_WALLET_UNAVAILABLE_MESSAGE,
  AppleWalletPassGenerator,
} from "./apple-wallet-pass.generator";

/** Lifetime of a download link (Safari opens it right away). */
export const WALLET_PASS_TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * Downloads one link may serve. Not 1: some iOS browsers fetch the URL several
 * times before handing the pass to Wallet (Firefox iOS: its own GET, then
 * CFNetwork, then its FxA client, within ~300 ms) — a single-use link made
 * Wallet fail on the last fetch. Small enough to bound a leaked link.
 */
export const WALLET_PASS_MAX_DOWNLOADS = 5;

/** 32 random bytes, unpadded base64url. */
export const WALLET_PASS_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const LICENSE_NOT_FOUND_MESSAGE = "Aucune licence pour ce compte";
export const LICENSE_EXPIRED_MESSAGE =
  "Licence expirée : renouvelez-la avant de l'ajouter à Apple Wallet";
export const TOKEN_INVALID_MESSAGE =
  "Lien de téléchargement invalide ou épuisé : relancez l'ajout depuis l'application";
export const TOKEN_EXPIRED_MESSAGE =
  "Lien de téléchargement expiré : relancez l'ajout depuis l'application";

/** SHA-256 hex of the token (shared repo helper): only the hash is stored. */
export const hashWalletPassToken = hashToken;

export interface IssuedWalletPassToken {
  /** Raw token — returned once, only its SHA-256 is stored. */
  token: string;
  expiresAt: Date;
}

/**
 * Apple Wallet license pass download flow (#162):
 * 1. the authenticated app asks for a short-lived download token;
 * 2. the browser (no JWT) exchanges that token for the signed `.pkpass`, up to
 *    `WALLET_PASS_MAX_DOWNLOADS` times within its lifetime.
 *
 * Tokens live in Postgres (hashed): unlike the Redis cache, which degrades to
 * "nothing stored" when unavailable, a quota needs a deterministic store with
 * an atomic conditional increment. No scheduled cleanup (scale-to-zero
 * backend): issuing a token replaces the user's previous one and resets its
 * counter (one row per user, upsert).
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
    const tokenHash = hashWalletPassToken(token);
    // One row per user (`userId` unique): a new token replaces the previous
    // one, even for two simultaneous requests (INSERT … ON CONFLICT), and the
    // table never grows without a cron.
    await this.prisma.walletPassDownloadToken.upsert({
      where: { userId },
      create: { tokenHash, userId, expiresAt },
      update: { tokenHash, expiresAt, downloadCount: 0 },
      select: { id: true },
    });
    return { token, expiresAt };
  }

  /**
   * Looks a token up without spending a download: 404 if unknown, malformed or
   * out of downloads, 410 if expired.
   */
  private async findUsableToken(
    token: string,
    now: Date,
  ): Promise<{ tokenHash: string; userId: string }> {
    if (!WALLET_PASS_TOKEN_PATTERN.test(token)) {
      throw new NotFoundException(TOKEN_INVALID_MESSAGE);
    }
    const tokenHash = hashWalletPassToken(token);
    const row = await this.prisma.walletPassDownloadToken.findUnique({
      where: { tokenHash },
      select: walletPassTokenSelect,
    });
    if (!row) throw new NotFoundException(TOKEN_INVALID_MESSAGE);
    if (row.expiresAt.getTime() <= now.getTime()) {
      throw new GoneException(TOKEN_EXPIRED_MESSAGE);
    }
    if (row.downloadCount >= WALLET_PASS_MAX_DOWNLOADS) {
      throw new NotFoundException(TOKEN_INVALID_MESSAGE);
    }
    return { tokenHash, userId: row.userId };
  }

  /**
   * `HEAD` on the download link: same status as a `GET` would get for the
   * token, without spending a download nor signing a pass.
   */
  async checkDownloadToken(
    token: string,
    now: Date = new Date(),
  ): Promise<void> {
    this.ensureAvailable();
    await this.findUsableToken(token, now);
  }

  /**
   * Step 2 — spends one download of the token and returns the signed pass.
   * The feature check comes first so a disabled feature does not spend it.
   */
  async consumeAndGeneratePass(
    token: string,
    now: Date = new Date(),
  ): Promise<Buffer> {
    this.ensureAvailable();
    const { tokenHash, userId } = await this.findUsableToken(token, now);

    // Atomic conditional increment: whatever the concurrency, at most
    // WALLET_PASS_MAX_DOWNLOADS requests get a row back. A token replaced,
    // expired or exhausted since the lookup matches nothing ⇒ 404.
    const { count } = await this.prisma.walletPassDownloadToken.updateMany({
      where: {
        tokenHash,
        expiresAt: { gt: now },
        downloadCount: { lt: WALLET_PASS_MAX_DOWNLOADS },
      },
      data: { downloadCount: { increment: 1 } },
    });
    if (count !== 1) throw new NotFoundException(TOKEN_INVALID_MESSAGE);

    const license = await this.loadActiveLicense(userId, now);
    return this.generator.generate(license);
  }
}
