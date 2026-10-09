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
  WALLET_PASS_MAX_DOWNLOADS,
  WALLET_PASS_TOKEN_PATTERN,
  WALLET_PASS_TOKEN_TTL_MS,
} from "./apple-wallet-pass.service";

interface TokenRow {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  downloadCount: number;
}

interface CountedUpdate {
  where: {
    tokenHash: string;
    expiresAt: { gt: Date };
    downloadCount: { lt: number };
  };
  data: { downloadCount: { increment: number } };
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
  const tokens: TokenRow[] = [];
  const walletPassDownloadToken = {
    // Same semantics as UPDATE … WHERE (conditions) — evaluated and applied
    // synchronously, like a single SQL statement.
    updateMany: jest.fn(({ where, data }: CountedUpdate) => {
      const row = tokens.find(
        (t) =>
          t.tokenHash === where.tokenHash &&
          t.expiresAt.getTime() > where.expiresAt.gt.getTime() &&
          t.downloadCount < where.downloadCount.lt,
      );
      if (row) row.downloadCount += data.downloadCount.increment;
      return Promise.resolve({ count: row ? 1 : 0 });
    }),
    // `userId` is unique: same semantics as INSERT … ON CONFLICT (userId).
    upsert: jest.fn(
      ({
        where,
        create,
        update,
      }: {
        where: { userId: string };
        create: Omit<TokenRow, "downloadCount">;
        update: Omit<TokenRow, "userId">;
      }) => {
        const existing = tokens.find((t) => t.userId === where.userId);
        if (existing) Object.assign(existing, update);
        else tokens.push({ ...create, downloadCount: 0 });
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
        {
          tokenHash: hashWalletPassToken(token),
          userId: "alice",
          expiresAt,
          downloadCount: 0,
        },
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
    it("returns the pass of the token's owner, several times", async () => {
      const { token } = await service.issueDownloadToken("alice", NOW);
      await service.issueDownloadToken("bob", NOW);

      // Firefox iOS fetches the link three times within ~300 ms.
      for (let i = 0; i < 3; i++) {
        await expect(
          service.consumeAndGeneratePass(token, NOW),
        ).resolves.toEqual(Buffer.from("pkpass"));
      }
      expect(generator.generate).toHaveBeenCalledTimes(3);
      expect(generator.generate).toHaveBeenCalledWith({
        id: "lic-alice",
        number: "FFD-A",
        category: "Standard",
        validUntil: licenses.alice.validUntil,
        firstName: "Alice",
        lastName: "A",
      });
      expect(
        fake.tokens().find((t) => t.userId === "alice")?.downloadCount,
      ).toBe(3);
      // Bob's token is untouched.
      expect(fake.tokens().find((t) => t.userId === "bob")?.downloadCount).toBe(
        0,
      );
    });

    it("404 once the download quota is spent", async () => {
      const { token } = await service.issueDownloadToken("alice", NOW);
      for (let i = 0; i < WALLET_PASS_MAX_DOWNLOADS; i++) {
        await service.consumeAndGeneratePass(token, NOW);
      }
      await expect(service.consumeAndGeneratePass(token, NOW)).rejects.toThrow(
        new NotFoundException(TOKEN_INVALID_MESSAGE),
      );
      expect(generator.generate).toHaveBeenCalledTimes(
        WALLET_PASS_MAX_DOWNLOADS,
      );
      expect(fake.tokens()[0].downloadCount).toBe(WALLET_PASS_MAX_DOWNLOADS);
    });

    it("stays usable until the end of its lifetime", async () => {
      const { token } = await service.issueDownloadToken("alice", NOW);
      const justBefore = new Date(NOW.getTime() + WALLET_PASS_TOKEN_TTL_MS - 1);
      await service.consumeAndGeneratePass(token, NOW);
      await expect(
        service.consumeAndGeneratePass(token, justBefore),
      ).resolves.toEqual(Buffer.from("pkpass"));
    });

    it("410 once the token has expired, without spending it", async () => {
      const { token } = await service.issueDownloadToken("alice", NOW);
      const later = new Date(NOW.getTime() + WALLET_PASS_TOKEN_TTL_MS);
      await expect(
        service.consumeAndGeneratePass(token, later),
      ).rejects.toThrow(new GoneException(TOKEN_EXPIRED_MESSAGE));
      expect(fake.tokens()[0].downloadCount).toBe(0);
      expect(generator.generate).not.toHaveBeenCalled();
    });

    it("a new link replaces the previous one and resets the quota", async () => {
      const first = await service.issueDownloadToken("alice", NOW);
      for (let i = 0; i < WALLET_PASS_MAX_DOWNLOADS; i++) {
        await service.consumeAndGeneratePass(first.token, NOW);
      }
      const second = await service.issueDownloadToken("alice", NOW);
      expect(fake.tokens()).toHaveLength(1);
      expect(fake.tokens()[0].downloadCount).toBe(0);
      expect(
        fake.prisma.walletPassDownloadToken.upsert,
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ downloadCount: 0 }),
        }),
      );

      await expect(
        service.consumeAndGeneratePass(first.token, NOW),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.consumeAndGeneratePass(second.token, NOW),
      ).resolves.toEqual(Buffer.from("pkpass"));
    });

    it("404 for an unknown or malformed token", async () => {
      await expect(
        service.consumeAndGeneratePass("A".repeat(43), NOW),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.consumeAndGeneratePass("short", NOW),
      ).rejects.toThrow(NotFoundException);
    });

    it("never serves more than the quota to concurrent requests", async () => {
      const { token } = await service.issueDownloadToken("alice", NOW);
      const results = await Promise.allSettled(
        Array.from({ length: WALLET_PASS_MAX_DOWNLOADS + 3 }, () =>
          service.consumeAndGeneratePass(token, NOW),
        ),
      );
      const served = results.filter((r) => r.status === "fulfilled");
      const refused = results.filter(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      expect(served).toHaveLength(WALLET_PASS_MAX_DOWNLOADS);
      expect(refused).toHaveLength(3);
      for (const r of refused) {
        expect(r.reason).toBeInstanceOf(NotFoundException);
      }
      expect(fake.tokens()[0].downloadCount).toBe(WALLET_PASS_MAX_DOWNLOADS);
    });

    it("increments only through the conditional update", async () => {
      const { token } = await service.issueDownloadToken("alice", NOW);
      await service.consumeAndGeneratePass(token, NOW);
      expect(
        fake.prisma.walletPassDownloadToken.updateMany,
      ).toHaveBeenCalledWith({
        where: {
          tokenHash: hashWalletPassToken(token),
          expiresAt: { gt: NOW },
          downloadCount: { lt: WALLET_PASS_MAX_DOWNLOADS },
        },
        data: { downloadCount: { increment: 1 } },
      });
    });

    it("404 when the conditional update matches nothing (race lost)", async () => {
      const { token } = await service.issueDownloadToken("alice", NOW);
      fake.prisma.walletPassDownloadToken.updateMany.mockResolvedValueOnce({
        count: 0,
      });
      await expect(service.consumeAndGeneratePass(token, NOW)).rejects.toThrow(
        new NotFoundException(TOKEN_INVALID_MESSAGE),
      );
      expect(generator.generate).not.toHaveBeenCalled();
    });

    it("503 when disabled, without spending a download", async () => {
      const { token } = await service.issueDownloadToken("alice", NOW);
      generator.isAvailable.mockReturnValue(false);
      await expect(service.consumeAndGeneratePass(token, NOW)).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(fake.tokens()[0].downloadCount).toBe(0);
      expect(
        fake.prisma.walletPassDownloadToken.updateMany,
      ).not.toHaveBeenCalled();
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

  describe("checkDownloadToken (HEAD)", () => {
    it("accepts a usable token without spending a download", async () => {
      const { token } = await service.issueDownloadToken("alice", NOW);
      for (let i = 0; i < WALLET_PASS_MAX_DOWNLOADS + 2; i++) {
        await expect(
          service.checkDownloadToken(token, NOW),
        ).resolves.toBeUndefined();
      }
      expect(fake.tokens()[0].downloadCount).toBe(0);
      expect(
        fake.prisma.walletPassDownloadToken.updateMany,
      ).not.toHaveBeenCalled();
      expect(generator.generate).not.toHaveBeenCalled();
      // HEADs did not eat into the GET quota.
      await expect(service.consumeAndGeneratePass(token, NOW)).resolves.toEqual(
        Buffer.from("pkpass"),
      );
    });

    it("mirrors the GET statuses: 404 unknown/exhausted, 410 expired, 503 disabled", async () => {
      await expect(
        service.checkDownloadToken("A".repeat(43), NOW),
      ).rejects.toThrow(NotFoundException);
      await expect(service.checkDownloadToken("short", NOW)).rejects.toThrow(
        NotFoundException,
      );

      const { token } = await service.issueDownloadToken("alice", NOW);
      await expect(
        service.checkDownloadToken(
          token,
          new Date(NOW.getTime() + WALLET_PASS_TOKEN_TTL_MS),
        ),
      ).rejects.toThrow(GoneException);

      fake.tokens()[0].downloadCount = WALLET_PASS_MAX_DOWNLOADS;
      await expect(service.checkDownloadToken(token, NOW)).rejects.toThrow(
        new NotFoundException(TOKEN_INVALID_MESSAGE),
      );

      generator.isAvailable.mockReturnValue(false);
      await expect(service.checkDownloadToken(token, NOW)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
