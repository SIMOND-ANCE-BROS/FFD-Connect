import {
  GoneException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AppleWalletPassGenerator } from "./apple-wallet-pass.generator";
import {
  AppleWalletPassService,
  hashWalletPassToken,
  LICENSE_EXPIRED_MESSAGE,
  TOKEN_EXPIRED_MESSAGE,
  TOKEN_INVALID_MESSAGE,
  WALLET_PASS_TOKEN_PATTERN,
  WALLET_PASS_TOKEN_TTL_MS,
} from "./apple-wallet-pass.service";

interface TokenRow {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}

interface LicenseRow {
  id: string;
  number: string;
  category: string;
  validUntil: Date;
  user: { firstName: string; lastName: string } | null;
}

/** In-memory stand-in for the two tables the service touches. */
function fakePrisma(licenses: Record<string, LicenseRow>) {
  let tokens: TokenRow[] = [];
  const walletPassDownloadToken = {
    deleteMany: jest.fn(({ where }: { where: { tokenHash: string } }) => {
      const before = tokens.length;
      tokens = tokens.filter((t) => t.tokenHash !== where.tokenHash);
      return Promise.resolve({ count: before - tokens.length });
    }),
    // `userId` is unique: same semantics as INSERT … ON CONFLICT (userId).
    upsert: jest.fn(
      ({
        where,
        create,
        update,
      }: {
        where: { userId: string };
        create: TokenRow;
        update: Omit<TokenRow, "userId">;
      }) => {
        const existing = tokens.find((t) => t.userId === where.userId);
        if (existing) Object.assign(existing, update);
        else tokens.push({ ...create });
        return Promise.resolve({ id: "row" });
      },
    ),
    findUnique: jest.fn(({ where }: { where: { tokenHash: string } }) =>
      Promise.resolve(
        tokens.find((t) => t.tokenHash === where.tokenHash) ?? null,
      ),
    ),
  };
  return {
    prisma: {
      walletPassDownloadToken,
      license: {
        findUnique: jest.fn(({ where }: { where: { userId: string } }) =>
          Promise.resolve(licenses[where.userId] ?? null),
        ),
      },
    },
    tokens: () => tokens,
  };
}

const NOW = new Date("2026-10-08T10:00:00.000Z");

const licenses: Record<string, LicenseRow> = {
  alice: {
    id: "lic-alice",
    number: "FFD-A",
    category: "Standard",
    validUntil: new Date("2027-08-30T22:00:00.000Z"),
    user: { firstName: "Alice", lastName: "A" },
  },
  bob: {
    id: "lic-bob",
    number: "FFD-B",
    category: "Loisir",
    validUntil: new Date("2027-08-30T22:00:00.000Z"),
    user: { firstName: "Bob", lastName: "B" },
  },
  expired: {
    id: "lic-old",
    number: "FFD-OLD",
    category: "Standard",
    // Ends 2026-10-07 in Paris: expired on 2026-10-08.
    validUntil: new Date("2026-10-06T22:00:00.000Z"),
    user: { firstName: "Old", lastName: "O" },
  },
  lastDay: {
    id: "lic-last",
    number: "FFD-LAST",
    category: "Standard",
    // 2026-10-08 in Paris: still valid all day.
    validUntil: new Date("2026-10-07T22:00:00.000Z"),
    user: { firstName: "Last", lastName: "L" },
  },
};

describe("AppleWalletPassService", () => {
  let fake: ReturnType<typeof fakePrisma>;
  let generator: { isAvailable: jest.Mock; generate: jest.Mock };
  let service: AppleWalletPassService;

  beforeEach(() => {
    fake = fakePrisma(licenses);
    generator = {
      isAvailable: jest.fn().mockReturnValue(true),
      generate: jest.fn().mockReturnValue(Buffer.from("pkpass")),
    };
    service = new AppleWalletPassService(
      fake.prisma as unknown as PrismaService,
      generator as unknown as AppleWalletPassGenerator,
    );
  });

  it("exposes the generator availability", () => {
    generator.isAvailable.mockReturnValue(false);
    expect(service.isAvailable()).toBe(false);
  });

  describe("issueDownloadToken", () => {
    it("issues a random token stored only as its SHA-256", async () => {
      const { token, expiresAt } = await service.issueDownloadToken(
        "alice",
        NOW,
      );
      expect(token).toMatch(WALLET_PASS_TOKEN_PATTERN);
      expect(expiresAt.getTime()).toBe(
        NOW.getTime() + WALLET_PASS_TOKEN_TTL_MS,
      );
      expect(fake.tokens()).toEqual([
        { tokenHash: hashWalletPassToken(token), userId: "alice", expiresAt },
      ]);
      expect(JSON.stringify(fake.tokens())).not.toContain(token);
    });

    it("keeps at most one live token per user", async () => {
      await service.issueDownloadToken("alice", NOW);
      await service.issueDownloadToken("bob", NOW);
      const { token } = await service.issueDownloadToken("alice", NOW);
      expect(
        fake
          .tokens()
          .map((t) => t.userId)
          .sort(),
      ).toEqual(["alice", "bob"]);
      expect(fake.tokens().find((t) => t.userId === "alice")?.tokenHash).toBe(
        hashWalletPassToken(token),
      );
      // Keyed on the unique userId, so concurrent requests cannot both insert.
      expect(
        fake.prisma.walletPassDownloadToken.upsert,
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { userId: "alice" } }),
      );
    });

    it("404 without a license", async () => {
      await expect(service.issueDownloadToken("nobody", NOW)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("422 for an expired license", async () => {
      await expect(service.issueDownloadToken("expired", NOW)).rejects.toThrow(
        new UnprocessableEntityException(LICENSE_EXPIRED_MESSAGE),
      );
    });

    it("accepts a license on its last valid day (Paris)", async () => {
      await expect(
        service.issueDownloadToken("lastDay", NOW),
      ).resolves.toBeDefined();
    });

    it("503 when the feature is disabled, without storing anything", async () => {
      generator.isAvailable.mockReturnValue(false);
      await expect(service.issueDownloadToken("alice", NOW)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(fake.tokens()).toHaveLength(0);
    });
  });

  describe("consumeAndGeneratePass", () => {
    it("returns the pass of the token's owner, once", async () => {
      const { token } = await service.issueDownloadToken("alice", NOW);
      await service.issueDownloadToken("bob", NOW);

      await expect(service.consumeAndGeneratePass(token, NOW)).resolves.toEqual(
        Buffer.from("pkpass"),
      );
      expect(generator.generate).toHaveBeenCalledWith({
        id: "lic-alice",
        number: "FFD-A",
        category: "Standard",
        validUntil: licenses.alice.validUntil,
        firstName: "Alice",
        lastName: "A",
      });

      await expect(service.consumeAndGeneratePass(token, NOW)).rejects.toThrow(
        new NotFoundException(TOKEN_INVALID_MESSAGE),
      );
      // Bob's token is untouched.
      expect(fake.tokens().map((t) => t.userId)).toEqual(["bob"]);
    });

    it("410 once the token has expired (and burns it)", async () => {
      const { token } = await service.issueDownloadToken("alice", NOW);
      const later = new Date(NOW.getTime() + WALLET_PASS_TOKEN_TTL_MS);
      await expect(
        service.consumeAndGeneratePass(token, later),
      ).rejects.toThrow(new GoneException(TOKEN_EXPIRED_MESSAGE));
      expect(fake.tokens()).toHaveLength(0);
      expect(generator.generate).not.toHaveBeenCalled();
    });

    it("404 for an unknown or malformed token", async () => {
      await expect(
        service.consumeAndGeneratePass("A".repeat(43), NOW),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.consumeAndGeneratePass("short", NOW),
      ).rejects.toThrow(NotFoundException);
    });

    it("404 when a concurrent request consumed the token first", async () => {
      const { token } = await service.issueDownloadToken("alice", NOW);
      fake.prisma.walletPassDownloadToken.deleteMany.mockResolvedValueOnce({
        count: 0,
      });
      await expect(service.consumeAndGeneratePass(token, NOW)).rejects.toThrow(
        NotFoundException,
      );
      expect(generator.generate).not.toHaveBeenCalled();
    });

    it("503 when disabled, without burning the token", async () => {
      const { token } = await service.issueDownloadToken("alice", NOW);
      generator.isAvailable.mockReturnValue(false);
      await expect(service.consumeAndGeneratePass(token, NOW)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(fake.tokens()).toHaveLength(1);
    });

    it("422 when the license expired between issue and download", async () => {
      const { token } = await service.issueDownloadToken("lastDay", NOW);
      const nextDay = new Date("2026-10-08T22:01:00.000Z");
      fake.tokens()[0].expiresAt = new Date(nextDay.getTime() + 60_000);
      await expect(
        service.consumeAndGeneratePass(token, nextDay),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it("404 when the license row lost its user", async () => {
      const orphan = fakePrisma({
        ghost: { ...licenses.alice, user: null },
      });
      const svc = new AppleWalletPassService(
        orphan.prisma as unknown as PrismaService,
        generator as unknown as AppleWalletPassGenerator,
      );
      await expect(svc.issueDownloadToken("ghost", NOW)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
