import { ConflictException, NotFoundException } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { mockDeep, MockProxy } from "jest-mock-extended";
import { PrismaService } from "../prisma/prisma.service";
import { privacyPolicyNotice } from "./privacy-policy-notice";
import { PrivacyPolicyNoticeQueryService } from "./privacy-policy-notice.query-service";
import { PrivacyPolicyNoticeService } from "./privacy-policy-notice.service";
import {
  PRIVACY_POLICY_VERSION,
  PRIVACY_POLICY_VERSION_PATTERN,
} from "./privacy-policy-version";

describe("privacy policy notice (#734)", () => {
  let prisma: MockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  describe("PRIVACY_POLICY_VERSION", () => {
    it("is a date, so that it can be acknowledged", () => {
      expect(PRIVACY_POLICY_VERSION).toMatch(PRIVACY_POLICY_VERSION_PATTERN);
    });

    // The #387 update must reach every existing account once.
    it("announces the #387 update", () => {
      expect(PRIVACY_POLICY_VERSION).toBe("2026-10-18");
    });
  });

  describe("privacyPolicyNotice", () => {
    it("is pending for an account that was never told (existing accounts)", () => {
      expect(privacyPolicyNotice(null)).toEqual({
        currentVersion: PRIVACY_POLICY_VERSION,
        seenVersion: null,
        pending: true,
      });
    });

    it("is pending after an older version", () => {
      expect(privacyPolicyNotice("2026-01-01").pending).toBe(true);
    });

    it("is not pending once the current version is acknowledged", () => {
      expect(privacyPolicyNotice(PRIVACY_POLICY_VERSION).pending).toBe(false);
    });
  });

  describe("PrivacyPolicyNoticeQueryService", () => {
    const service = () =>
      new PrivacyPolicyNoticeQueryService(prisma as unknown as PrismaService);

    it("reads only the acknowledged version of the user", async () => {
      prisma.user.findUnique.mockResolvedValue({
        privacyPolicySeenVersion: null,
      });

      const notice = await service().getNotice("u1");

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "u1" },
        select: { privacyPolicySeenVersion: true },
      });
      expect(notice.pending).toBe(true);
    });

    it("404s for an unknown user", async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service().getNotice("ghost")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("PrivacyPolicyNoticeService", () => {
    const service = () =>
      new PrivacyPolicyNoticeService(prisma as unknown as PrismaService);

    it("records the current version", async () => {
      prisma.user.update.mockResolvedValue({
        privacyPolicySeenVersion: PRIVACY_POLICY_VERSION,
      });

      const notice = await service().acknowledge("u1", PRIVACY_POLICY_VERSION);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { privacyPolicySeenVersion: PRIVACY_POLICY_VERSION },
        select: { privacyPolicySeenVersion: true },
      });
      expect(notice).toEqual({
        currentVersion: PRIVACY_POLICY_VERSION,
        seenVersion: PRIVACY_POLICY_VERSION,
        pending: false,
      });
    });

    it("refuses a version that is no longer current, writing nothing", async () => {
      await expect(
        service().acknowledge("u1", "2020-01-01"),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
