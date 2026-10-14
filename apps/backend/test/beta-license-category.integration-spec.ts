import { randomUUID } from "crypto";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import {
  BETA_AUTO_LICENSE_CLUB_NAME,
  BETA_LICENSE_PLACEHOLDER_CATEGORY,
  LEGACY_BETA_LICENSE_CATEGORY,
} from "../src/licenses/beta-license-placeholder";
import { PrismaService } from "../src/prisma/prisma.service";
import { repairBetaLicenseCategories } from "../scripts/seed-beta-testers.utils";
import { buildHttpApp } from "./integration-app.builder";

/**
 * Beta licences never declare a discipline (#555), on a real database:
 * registering against a placeholder licence leaves User.category empty, and
 * the boot repair fixes the "Ten Dance" licences and profiles of earlier
 * testers without touching real federation licences or explicit choices.
 */
describe("Beta licence category (integration, real DB, #555)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const licenseNumbers: string[] = [];
  const userIds: string[] = [];

  const oneYearAhead = () => new Date(Date.now() + 365 * 24 * 3600 * 1000);

  const createLicense = async (o: {
    category: string;
    clubName?: string;
    userCategory?: string | null;
  }) => {
    const number = `E2E-555-${tag}-${licenseNumbers.length}`;
    licenseNumbers.push(number);
    let userId: string | null = null;
    if (o.userCategory !== undefined) {
      const user = await prisma.user.create({
        data: {
          email: `${randomUUID()}@test.local`,
          password: "x",
          firstName: "Beta",
          lastName: "Testeur",
          category: o.userCategory,
        },
        select: { id: true },
      });
      userIds.push(user.id);
      userId = user.id;
    }
    await prisma.license.create({
      data: {
        number,
        validUntil: oneYearAhead(),
        category: o.category,
        clubName: o.clubName ?? "Club Villeurbannais de Danse Sportive",
        userId,
      },
      select: { id: true },
    });
    return { number, userId };
  };

  beforeAll(async () => {
    ({ app, prisma } = await buildHttpApp());
  });

  afterAll(async () => {
    await prisma.license.deleteMany({
      where: { number: { in: licenseNumbers } },
    });
    await prisma.refreshToken.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  it("registering against a placeholder beta licence leaves the discipline unknown", async () => {
    const { number } = await createLicense({
      category: BETA_LICENSE_PLACEHOLDER_CATEGORY,
    });

    const res = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post("/api/v1/auth/register")
      .send({
        email: `beta-${tag}@test.local`,
        password: "Brand-New-Pass1!",
        licenseNumber: number,
        lastName: "Testeur",
        firstName: "Beta",
      });

    expect(res.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: `beta-${tag}@test.local` },
      select: { id: true, category: true },
    });
    userIds.push(user.id);
    expect(user.category).toBeNull();
    expect(res.body.user.category).toBeNull();
  });

  it("repairs earlier beta licences and their copied Ten Dance profiles only", async () => {
    const seeded = await createLicense({
      category: LEGACY_BETA_LICENSE_CATEGORY,
      userCategory: LEGACY_BETA_LICENSE_CATEGORY,
    });
    const autoCreated = await createLicense({
      category: LEGACY_BETA_LICENSE_CATEGORY,
      clubName: BETA_AUTO_LICENSE_CLUB_NAME,
      userCategory: LEGACY_BETA_LICENSE_CATEGORY,
    });
    // Tester who has since picked a single discipline: kept.
    const chosen = await createLicense({
      category: LEGACY_BETA_LICENSE_CATEGORY,
      clubName: BETA_AUTO_LICENSE_CLUB_NAME,
      userCategory: "Latin",
    });
    // A real "Ten Dance" licence (not listed, real club): untouched.
    const real = await createLicense({
      category: LEGACY_BETA_LICENSE_CATEGORY,
      userCategory: LEGACY_BETA_LICENSE_CATEGORY,
    });

    const first = await repairBetaLicenseCategories(prisma, [seeded.number]);
    expect(first.licenses).toBeGreaterThanOrEqual(3);
    expect(first.users).toBeGreaterThanOrEqual(2);

    const licenseCategory = async (number: string) =>
      (
        await prisma.license.findUniqueOrThrow({
          where: { number },
          select: { category: true },
        })
      ).category;
    const userCategory = async (id: string | null) =>
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: id ?? "" },
          select: { category: true },
        })
      ).category;

    for (const repaired of [seeded, autoCreated, chosen]) {
      expect(await licenseCategory(repaired.number)).toBe(
        BETA_LICENSE_PLACEHOLDER_CATEGORY,
      );
    }
    expect(await userCategory(seeded.userId)).toBeNull();
    expect(await userCategory(autoCreated.userId)).toBeNull();
    expect(await userCategory(chosen.userId)).toBe("Latin");
    expect(await licenseCategory(real.number)).toBe(
      LEGACY_BETA_LICENSE_CATEGORY,
    );
    expect(await userCategory(real.userId)).toBe(LEGACY_BETA_LICENSE_CATEGORY);

    // Later boots: nothing left to repair, a Ten Dance chosen since is kept.
    await prisma.user.update({
      where: { id: seeded.userId ?? "" },
      data: { category: LEGACY_BETA_LICENSE_CATEGORY },
      select: { id: true },
    });
    await repairBetaLicenseCategories(prisma, [seeded.number]);
    expect(await userCategory(seeded.userId)).toBe(
      LEGACY_BETA_LICENSE_CATEGORY,
    );
  });
});
