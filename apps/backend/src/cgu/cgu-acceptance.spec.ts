import { ConflictException, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { mockDeep, MockProxy } from "jest-mock-extended";
import { PARENTAL_CONSENT_CGU_VERSION } from "../parental-consent/parental-consent.policy";
import { PrismaService } from "../prisma/prisma.service";
import { cguAcceptance } from "./cgu-acceptance";
import { CguAcceptanceQueryService } from "./cgu-acceptance.query-service";
import { CguAcceptanceService } from "./cgu-acceptance.service";
import { CGU_VERSION, CGU_VERSION_PATTERN } from "./cgu-version";

describe("CGU acceptance per account (#894)", () => {
  let prisma: MockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("CGU_VERSION", () => {
    it("matches the accepted shape", () => {
      expect(CGU_VERSION).toMatch(CGU_VERSION_PATTERN);
    });

    // Must stay equal to the client's CGU_VERSION (cguConsent.ts).
    it("is v4, the version a parent accepts for a minor", () => {
      expect(CGU_VERSION).toBe("4");
      expect(PARENTAL_CONSENT_CGU_VERSION).toBe(CGU_VERSION);
    });
  });

  describe("cguAcceptance", () => {
    it("is not accepted for an account that never accepted (existing accounts)", () => {
      expect(
        cguAcceptance({ cguAcceptedVersion: null, cguAcceptedAt: null }),
      ).toEqual({
        currentVersion: CGU_VERSION,
        acceptedVersion: null,
        acceptedAt: null,
        accepted: false,
      });
    });

    it("is not accepted after an older version", () => {
      expect(
        cguAcceptance({
          cguAcceptedVersion: "2",
          cguAcceptedAt: new Date("2026-01-01T00:00:00Z"),
        }).accepted,
      ).toBe(false);
    });

    it("is accepted for the current version, with its date", () => {
      expect(
        cguAcceptance({
          cguAcceptedVersion: CGU_VERSION,
          cguAcceptedAt: new Date("2026-11-03T10:00:00Z"),
        }),
      ).toEqual({
        currentVersion: CGU_VERSION,
        acceptedVersion: CGU_VERSION,
        acceptedAt: "2026-11-03T10:00:00.000Z",
        accepted: true,
      });
    });
  });

  describe("CguAcceptanceQueryService", () => {
    const service = () =>
      new CguAcceptanceQueryService(prisma as unknown as PrismaService);

    it("reads only the acceptance of the user", async () => {
      prisma.user.findUnique.mockResolvedValue({
        cguAcceptedVersion: null,
        cguAcceptedAt: null,
      });
      const acceptance = await service().getAcceptance("u1");
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "u1" },
        select: { cguAcceptedVersion: true, cguAcceptedAt: true },
      });
      expect(acceptance.accepted).toBe(false);
    });

    it("404s for an unknown user", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service().getAcceptance("ghost")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("CguAcceptanceService", () => {
    const service = () =>
      new CguAcceptanceService(prisma as unknown as PrismaService);

    it("records the current version once, keeping the first timestamp", async () => {
      const at = new Date("2026-11-03T10:00:00Z");
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUnique.mockResolvedValue({
        cguAcceptedVersion: CGU_VERSION,
        cguAcceptedAt: at,
      });

      const acceptance = await service().accept("u1", CGU_VERSION);

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: {
          id: "u1",
          OR: [
            { cguAcceptedVersion: null },
            { cguAcceptedVersion: { not: CGU_VERSION } },
          ],
        },
        data: {
          cguAcceptedVersion: CGU_VERSION,
          cguAcceptedAt: expect.any(Date),
        },
      });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "u1" },
        select: { cguAcceptedVersion: true, cguAcceptedAt: true },
      });
      expect(acceptance).toEqual({
        currentVersion: CGU_VERSION,
        acceptedVersion: CGU_VERSION,
        acceptedAt: at.toISOString(),
        accepted: true,
      });
    });

    it("refuses a version that is no longer current, writing nothing", async () => {
      await expect(service().accept("u1", "2")).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it("404s for an unknown user", async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 0 });
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service().accept("ghost", CGU_VERSION),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
