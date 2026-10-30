import { PrismaClient } from "@prisma/client";
import { mockDeep, MockProxy } from "jest-mock-extended";
import { isLicenseCoveredForRenewal } from "../src/licenses/license-season";
import {
  idOnlySelect,
  licenseRecetteStateSelect,
} from "../src/utils/prisma-selects";
import {
  applyRecetteLicenseState,
  isRecetteSeedEnabled,
  parisLastInstantOfDay,
  RECETTE_LICENSE_STATES,
} from "./seed-recette-licenses.utils";

const RENEWABLE = { number: "19920510-rec-re03", validUntilDay: "2026-12-31" };

describe("RECETTE_LICENSE_STATES (#887)", () => {
  it("targets the two fictitious recette numbers", () => {
    expect(RECETTE_LICENSE_STATES).toEqual([
      RENEWABLE,
      { number: "19880101-rec-ex04", validUntilDay: "2026-08-31" },
    ]);
  });

  it("makes re03 renewable (valid now, season 2026-2027 not covered) and ex04 expired", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    const re03 = parisLastInstantOfDay("2026-12-31");
    const ex04 = parisLastInstantOfDay("2026-08-31");

    expect(re03.getTime()).toBeGreaterThan(now.getTime());
    expect(isLicenseCoveredForRenewal(re03, now)).toBe(false);
    expect(ex04.getTime()).toBeLessThan(now.getTime());
  });
});

describe("parisLastInstantOfDay", () => {
  it("is 23:59:59.999 Paris time in winter (UTC+1) and summer (UTC+2)", () => {
    expect(parisLastInstantOfDay("2026-12-31").toISOString()).toBe(
      "2026-12-31T22:59:59.999Z",
    );
    expect(parisLastInstantOfDay("2026-08-31").toISOString()).toBe(
      "2026-08-31T21:59:59.999Z",
    );
  });
});

describe("isRecetteSeedEnabled", () => {
  it("only runs when SEED_TEST_TRACKS is exactly true", () => {
    expect(isRecetteSeedEnabled("true")).toBe(true);
    expect(isRecetteSeedEnabled(undefined)).toBe(false);
    expect(isRecetteSeedEnabled("false")).toBe(false);
    expect(isRecetteSeedEnabled("TRUE")).toBe(false);
  });
});

describe("applyRecetteLicenseState (#887)", () => {
  let prisma: MockProxy<PrismaClient>;
  const target = parisLastInstantOfDay(RENEWABLE.validUntilDay);
  const yearLong = new Date("2027-10-20T10:00:00Z");

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    prisma.license.updateMany.mockResolvedValue({ count: 1 });
  });

  it("is a no-op when the number does not exist, and never creates a licence", async () => {
    prisma.license.findUnique.mockResolvedValue(null);

    await expect(applyRecetteLicenseState(prisma, RENEWABLE)).resolves.toBe(
      "missing",
    );
    expect(prisma.license.findUnique).toHaveBeenCalledWith({
      where: { number: RENEWABLE.number },
      select: licenseRecetteStateSelect,
    });
    expect(prisma.license.updateMany).not.toHaveBeenCalled();
    expect(prisma.license.upsert).not.toHaveBeenCalled();
    expect(prisma.license.create).not.toHaveBeenCalled();
  });

  it("updates validUntil when the holder never requested a renewal", async () => {
    prisma.license.findUnique.mockResolvedValue({
      id: "lic-1",
      userId: "user-1",
      validUntil: yearLong,
    });
    prisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);

    await expect(applyRecetteLicenseState(prisma, RENEWABLE)).resolves.toBe(
      "updated",
    );
    expect(prisma.licenseRenewalRequest.findFirst).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      select: idOnlySelect,
    });
    expect(prisma.license.updateMany).toHaveBeenCalledWith({
      where: {
        id: "lic-1",
        validUntil: yearLong,
        OR: [
          { userId: null },
          { user: { licenseRenewalRequests: { none: {} } } },
        ],
      },
      data: { validUntil: target },
    });
  });

  it("updates an unclaimed licence without looking for a request", async () => {
    prisma.license.findUnique.mockResolvedValue({
      id: "lic-1",
      userId: null,
      validUntil: yearLong,
    });

    await expect(applyRecetteLicenseState(prisma, RENEWABLE)).resolves.toBe(
      "updated",
    );
    expect(prisma.licenseRenewalRequest.findFirst).not.toHaveBeenCalled();
  });

  it("never touches the licence once a renewal request exists", async () => {
    prisma.license.findUnique.mockResolvedValue({
      id: "lic-1",
      userId: "user-1",
      validUntil: yearLong,
    });
    prisma.licenseRenewalRequest.findFirst.mockResolvedValue({
      id: "req-1",
    });

    await expect(applyRecetteLicenseState(prisma, RENEWABLE)).resolves.toBe(
      "renewal-requested",
    );
    expect(prisma.license.updateMany).not.toHaveBeenCalled();
  });

  it("skips when validUntil is already at the target instant", async () => {
    prisma.license.findUnique.mockResolvedValue({
      id: "lic-1",
      userId: "user-1",
      validUntil: new Date(target.getTime()),
    });
    prisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);

    await expect(applyRecetteLicenseState(prisma, RENEWABLE)).resolves.toBe(
      "already-set",
    );
    expect(prisma.license.updateMany).not.toHaveBeenCalled();
  });

  it("reports a licence changed between the read and the write", async () => {
    prisma.license.findUnique.mockResolvedValue({
      id: "lic-1",
      userId: "user-1",
      validUntil: yearLong,
    });
    prisma.licenseRenewalRequest.findFirst.mockResolvedValue(null);
    prisma.license.updateMany.mockResolvedValue({ count: 0 });

    await expect(applyRecetteLicenseState(prisma, RENEWABLE)).resolves.toBe(
      "changed-meanwhile",
    );
  });
});
