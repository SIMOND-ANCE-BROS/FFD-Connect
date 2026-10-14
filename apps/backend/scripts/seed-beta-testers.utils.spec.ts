import { PrismaClient } from "@prisma/client";
import { mockDeep, MockProxy } from "jest-mock-extended";
import {
  BETA_AUTO_LICENSE_CLUB_NAME,
  BETA_LICENSE_PLACEHOLDER_CATEGORY,
  LEGACY_BETA_LICENSE_CATEGORY,
} from "../src/licenses/beta-license-placeholder";
import { licenseIdHolderSelect } from "../src/utils/prisma-selects";
import {
  BETA_LICENSE_REPAIR_BATCH,
  betaLicensesFromEnv,
  repairBetaLicenseCategories,
} from "./seed-beta-testers.utils";

describe("betaLicensesFromEnv (#555)", () => {
  it("seeds every listed number with the placeholder category, never a discipline", () => {
    const licenses = betaLicensesFromEnv(" 20010101-abc-de12 ,, 19990202-x ");

    expect(licenses.map((l) => l.number)).toEqual([
      "20010101-abc-de12",
      "19990202-x",
    ]);
    for (const license of licenses) {
      expect(license.category).toBe(BETA_LICENSE_PLACEHOLDER_CATEGORY);
    }
  });

  it("returns nothing for an absent or blank list", () => {
    expect(betaLicensesFromEnv(undefined)).toEqual([]);
    expect(betaLicensesFromEnv(" , ")).toEqual([]);
  });
});

describe("repairBetaLicenseCategories (#555)", () => {
  let prisma: MockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.license.updateMany.mockResolvedValue({ count: 0 });
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    prisma.$transaction.mockResolvedValue([{ count: 0 }, { count: 0 }]);
  });

  it("targets only beta licences still carrying the legacy Ten Dance placeholder", async () => {
    prisma.license.findMany.mockResolvedValue([]);

    await repairBetaLicenseCategories(prisma, ["20010101-abc-de12"]);

    expect(prisma.license.findMany).toHaveBeenCalledWith({
      where: {
        category: LEGACY_BETA_LICENSE_CATEGORY,
        OR: [
          { number: { in: ["20010101-abc-de12"] } },
          { clubName: BETA_AUTO_LICENSE_CLUB_NAME },
        ],
      },
      select: licenseIdHolderSelect,
      take: BETA_LICENSE_REPAIR_BATCH,
    });
  });

  it("does nothing when no licence needs repair (later boots)", async () => {
    prisma.license.findMany.mockResolvedValue([]);

    const result = await repairBetaLicenseCategories(prisma, []);

    expect(result).toEqual({ licenses: 0, users: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("resets the licence to the placeholder and the copied Ten Dance profile to unknown", async () => {
    prisma.license.findMany.mockResolvedValue([
      { id: "lic-1", userId: "user-1" },
      { id: "lic-2", userId: null },
    ] as never);
    prisma.$transaction.mockResolvedValue([{ count: 2 }, { count: 1 }]);

    const result = await repairBetaLicenseCategories(prisma, []);

    expect(prisma.license.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["lic-1", "lic-2"] },
        category: LEGACY_BETA_LICENSE_CATEGORY,
      },
      data: { category: BETA_LICENSE_PLACEHOLDER_CATEGORY },
    });
    // Only a profile still declaring the copied "Ten Dance": a Latin or
    // Standard chosen since then is kept.
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["user-1"] },
        category: LEGACY_BETA_LICENSE_CATEGORY,
      },
      data: { category: null },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ licenses: 2, users: 1 });
  });
});
