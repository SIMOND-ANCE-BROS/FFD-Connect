import { randomUUID } from "crypto";
import { TestingModule } from "@nestjs/testing";
import { LicenseRenewalStatus, UserRole } from "@prisma/client";
import {
  applyRecetteLicenseState,
  parisLastInstantOfDay,
} from "../scripts/seed-recette-licenses.utils";
import { PrismaService } from "../src/prisma/prisma.service";
import { buildServiceModule } from "./integration-app.builder";

/**
 * #887: the staging recette seed sets a licence's end date exactly once, and
 * never again once its holder has a renewal request (requested or approved).
 */
describe("Recette licence states seed (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  const userIds: string[] = [];
  const numbers: string[] = [];
  const yearLong = new Date("2027-10-20T10:00:00Z");

  beforeAll(async () => {
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
  });

  afterEach(async () => {
    await prisma.licenseRenewalRequest.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.license.deleteMany({ where: { number: { in: numbers } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
    numbers.length = 0;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const target = () => {
    const number = `19920510-rec-it${randomUUID().slice(0, 8)}`;
    numbers.push(number);
    return { number, validUntilDay: "2026-12-31" };
  };

  const createHolder = async (number: string) => {
    const user = await prisma.user.create({
      data: {
        email: `recette-${randomUUID()}@example.org`,
        password: "hash",
        firstName: "Recette",
        lastName: "Renouvellement",
        role: UserRole.LICENSEE,
      },
    });
    userIds.push(user.id);
    await prisma.license.create({
      data: {
        number,
        validUntil: yearLong,
        category: "Standard",
        clubName: "Club",
        userId: user.id,
      },
    });
    return user;
  };

  const validUntilOf = async (number: string) =>
    (await prisma.license.findUniqueOrThrow({ where: { number } })).validUntil;

  it("sets the end date once, then is a no-op on the next boot", async () => {
    const t = target();
    await createHolder(t.number);

    await expect(applyRecetteLicenseState(prisma, t)).resolves.toBe("updated");
    await expect(validUntilOf(t.number)).resolves.toEqual(
      parisLastInstantOfDay("2026-12-31"),
    );
    await expect(applyRecetteLicenseState(prisma, t)).resolves.toBe(
      "already-set",
    );
  });

  it("never overwrites a licence whose renewal was approved", async () => {
    const t = target();
    const user = await createHolder(t.number);
    await applyRecetteLicenseState(prisma, t);

    // The tester renews: request approved, licence extended to 31/08/2027.
    await prisma.licenseRenewalRequest.create({
      data: { userId: user.id, status: LicenseRenewalStatus.APPROVED },
    });
    const renewed = parisLastInstantOfDay("2027-08-31");
    await prisma.license.update({
      where: { number: t.number },
      data: { validUntil: renewed },
    });

    await expect(applyRecetteLicenseState(prisma, t)).resolves.toBe(
      "renewal-requested",
    );
    await expect(validUntilOf(t.number)).resolves.toEqual(renewed);
  });

  it("does not write when a request appears between the read and the write", async () => {
    const t = target();
    const user = await createHolder(t.number);
    await prisma.licenseRenewalRequest.create({
      data: { userId: user.id, status: LicenseRenewalStatus.DRAFT },
    });

    // Same guarded write as the seed, bypassing its pre-check.
    const { count } = await prisma.license.updateMany({
      where: {
        number: t.number,
        OR: [
          { userId: null },
          { user: { licenseRenewalRequests: { none: {} } } },
        ],
      },
      data: { validUntil: parisLastInstantOfDay("2026-12-31") },
    });

    expect(count).toBe(0);
    await expect(validUntilOf(t.number)).resolves.toEqual(yearLong);
  });

  it("creates nothing when the number does not exist", async () => {
    const t = target();

    await expect(applyRecetteLicenseState(prisma, t)).resolves.toBe("missing");
    await expect(
      prisma.license.findUnique({ where: { number: t.number } }),
    ).resolves.toBeNull();
  });
});
