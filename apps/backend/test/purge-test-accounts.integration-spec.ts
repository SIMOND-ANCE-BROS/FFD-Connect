import { randomUUID } from "crypto";
import { TestingModule } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import { purgeTestUser } from "../scripts/purge-test-accounts.utils";
import { PrismaService } from "../src/prisma/prisma.service";
import { buildServiceModule } from "./integration-app.builder";

/**
 * #491: the staging purge is the one path that DELETES licences (seeded test
 * numbers). A deleted licence frees its number, which must be retired like a
 * renamed one (#466); a real licence is only unlinked and keeps its number.
 */
describe("Test accounts purge retires freed licence numbers (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const userIds: string[] = [];
  const numbers: string[] = [];
  const files = { deleteFiles: jest.fn().mockResolvedValue(new Set()) };
  const warn = jest.fn();

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
  });

  afterEach(async () => {
    await prisma.retiredLicenseNumber.deleteMany({
      where: { number: { in: numbers } },
    });
    await prisma.license.deleteMany({ where: { number: { in: numbers } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    numbers.length = 0;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  // Unique per run: the retired table is keyed by the number.
  const seededNumber = () => {
    const n = `SCAN-TEST-${Date.now()}${Math.floor(Math.random() * 1000)}`;
    numbers.push(n);
    return n;
  };
  const realNumber = () => {
    const n = `IT-${randomUUID().slice(0, 12)}`;
    numbers.push(n);
    return n;
  };

  const createTestAccount = async (number: string) => {
    const user = await prisma.user.create({
      data: {
        email: `purge-${randomUUID()}@test.com`,
        password: "hash",
        firstName: "Seed",
        lastName: "Scan",
        role: UserRole.LICENSEE,
      },
    });
    userIds.push(user.id);
    const license = await prisma.license.create({
      data: {
        number,
        validUntil: new Date(Date.now() + 120 * 86_400_000),
        category: "Standard",
        clubName: "Club",
        userId: user.id,
      },
    });
    return { user, license };
  };

  it("deletes a seeded licence and retires its number in the same transaction", async () => {
    const number = seededNumber();
    const { user, license } = await createTestAccount(number);

    const report = await purgeTestUser({ prisma, files, warn }, user.id);

    expect(report.seededLicensesDeleted).toBe(1);
    await expect(
      prisma.license.findUnique({ where: { number } }),
    ).resolves.toBeNull();
    await expect(
      prisma.retiredLicenseNumber.findUnique({ where: { number } }),
    ).resolves.toMatchObject({ number, licenseId: license.id });
    await expect(
      prisma.user.findUnique({ where: { id: user.id } }),
    ).resolves.toBeNull();
  });

  it("keeps a real licence, unlinked, and never retires its number", async () => {
    const number = realNumber();
    const { user, license } = await createTestAccount(number);

    const report = await purgeTestUser({ prisma, files, warn }, user.id);

    expect(report).toMatchObject({
      seededLicensesDeleted: 0,
      licensesUnlinked: 1,
    });
    await expect(
      prisma.license.findUnique({ where: { id: license.id } }),
    ).resolves.toMatchObject({ number, userId: null });
    await expect(
      prisma.retiredLicenseNumber.findUnique({ where: { number } }),
    ).resolves.toBeNull();
  });

  it("refreshes a number that was already retired instead of failing", async () => {
    const number = seededNumber();
    const { user, license } = await createTestAccount(number);
    const earlier = new Date("2025-01-01T00:00:00Z");
    await prisma.retiredLicenseNumber.create({
      data: { number, licenseId: null, retiredAt: earlier },
    });

    await purgeTestUser({ prisma, files, warn }, user.id);

    const row = await prisma.retiredLicenseNumber.findUnique({
      where: { number },
    });
    expect(row?.licenseId).toBe(license.id);
    expect(row?.retiredAt.getTime()).toBeGreaterThan(earlier.getTime());
  });
});
