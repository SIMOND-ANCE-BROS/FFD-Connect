import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { hashToken } from "../utils/token-hash.util";
import {
  linkState,
  PARENTAL_CONSENT_INVALID_LINK,
  PARENTAL_CONSENT_REQUIRED_MESSAGE,
  ParentalConsentQueryService,
} from "./parental-consent.query-service";

const NOW = new Date("2026-10-15T12:00:00Z");
const MINOR_BIRTH = new Date("2012-03-01T00:00:00Z");
const ADULT_BIRTH = new Date("1990-03-01T00:00:00Z");
const FUTURE = new Date("2026-10-20T00:00:00Z");
const PAST = new Date("2026-10-01T00:00:00Z");

function makePrisma() {
  return {
    user: { findUnique: jest.fn() },
    parentalConsent: { findFirst: jest.fn(), findUnique: jest.fn() },
  };
}

describe("ParentalConsentQueryService (#61)", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: ParentalConsentQueryService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ParentalConsentQueryService(
      prisma as unknown as PrismaService,
    );
  });

  describe("getState", () => {
    it("404s for an unknown user", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getState("u1", NOW)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("does not even read the records of an adult", async () => {
      prisma.user.findUnique.mockResolvedValue({ birthDate: ADULT_BIRTH });

      const view = await service.getState("u1", NOW);

      expect(view).toEqual({
        state: "NOT_REQUIRED",
        lastOutcome: null,
        parentEmailMasked: null,
        requestedAt: null,
        expiresAt: null,
        grantedAt: null,
        revokedAt: null,
      });
      expect(prisma.parentalConsent.findFirst).not.toHaveBeenCalled();
    });

    it("reads the latest non-superseded request of a minor", async () => {
      prisma.user.findUnique.mockResolvedValue({ birthDate: MINOR_BIRTH });
      const record = {
        status: "PENDING",
        parentEmailMasked: "p***@e***.com",
        requestedAt: PAST,
        expiresAt: FUTURE,
        grantedAt: null,
        revokedAt: null,
      };
      prisma.parentalConsent.findFirst.mockResolvedValue(record);

      const view = await service.getState("u1", NOW);

      expect(view).toEqual({
        state: "PENDING",
        lastOutcome: null,
        parentEmailMasked: "p***@e***.com",
        requestedAt: PAST,
        expiresAt: FUTURE,
        grantedAt: null,
        revokedAt: null,
      });
      const query = prisma.parentalConsent.findFirst.mock.calls[0][0];
      expect(query.where).toEqual({
        userId: "u1",
        status: { not: "SUPERSEDED" },
      });
      expect(query.orderBy).toEqual({ requestedAt: "desc" });
      // Never the secrets.
      expect(query.select.tokenHash).toBeUndefined();
      expect(query.select.parentEmailHash).toBeUndefined();
    });

    it("is REQUIRED for a minor who never asked", async () => {
      prisma.user.findUnique.mockResolvedValue({ birthDate: MINOR_BIRTH });
      prisma.parentalConsent.findFirst.mockResolvedValue(null);

      const view = await service.getState("u1", NOW);

      expect(view.state).toBe("REQUIRED");
      expect(view.parentEmailMasked).toBeNull();
    });

    it("defaults to the current date", async () => {
      prisma.user.findUnique.mockResolvedValue({ birthDate: ADULT_BIRTH });
      await expect(service.getState("u1")).resolves.toMatchObject({
        state: "NOT_REQUIRED",
      });
    });
  });

  describe("assertHealthDataAllowed", () => {
    it("lets an adult through", async () => {
      prisma.user.findUnique.mockResolvedValue({ birthDate: ADULT_BIRTH });
      await expect(service.assertHealthDataAllowed("u1")).resolves.toBe(
        undefined,
      );
    });

    it("lets an account of unknown age through (pending decision)", async () => {
      prisma.user.findUnique.mockResolvedValue({ birthDate: null });
      await expect(service.assertHealthDataAllowed("u1")).resolves.toBe(
        undefined,
      );
    });

    it("lets a minor with a granted consent through", async () => {
      prisma.user.findUnique.mockResolvedValue({ birthDate: MINOR_BIRTH });
      prisma.parentalConsent.findFirst.mockResolvedValue({
        status: "GRANTED",
        expiresAt: PAST,
      });
      await expect(service.assertHealthDataAllowed("u1")).resolves.toBe(
        undefined,
      );
    });

    it.each(["PENDING", "REVOKED"])(
      "refuses a minor whose latest request is %s",
      async (status) => {
        prisma.user.findUnique.mockResolvedValue({ birthDate: MINOR_BIRTH });
        prisma.parentalConsent.findFirst.mockResolvedValue({
          status,
          expiresAt: new Date(Date.now() + 86_400_000),
        });
        await expect(service.assertHealthDataAllowed("u1")).rejects.toThrow(
          new ForbiddenException(PARENTAL_CONSENT_REQUIRED_MESSAGE),
        );
      },
    );

    it("refuses a minor who never asked", async () => {
      prisma.user.findUnique.mockResolvedValue({ birthDate: MINOR_BIRTH });
      prisma.parentalConsent.findFirst.mockResolvedValue(null);
      await expect(service.assertHealthDataAllowed("u1")).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("findByToken / lookup", () => {
    const record = {
      id: "c1",
      userId: "u1",
      status: "PENDING",
      expiresAt: FUTURE,
      grantedAt: null,
      revokedAt: null,
      user: { firstName: "Léa" },
    };

    it("looks the link up by the SHA-256 of its token, never the token", async () => {
      prisma.parentalConsent.findUnique.mockResolvedValue(record);

      await service.findByToken("abc");

      expect(prisma.parentalConsent.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tokenHash: hashToken("abc") } }),
      );
    });

    it("refuses an unknown link", async () => {
      prisma.parentalConsent.findUnique.mockResolvedValue(null);
      await expect(service.findByToken("abc")).rejects.toThrow(
        new BadRequestException(PARENTAL_CONSENT_INVALID_LINK),
      );
    });

    it("refuses a link replaced by a newer request", async () => {
      prisma.parentalConsent.findUnique.mockResolvedValue({
        ...record,
        status: "SUPERSEDED",
      });
      await expect(service.findByToken("abc")).rejects.toThrow(
        BadRequestException,
      );
    });

    it("shows the parent the child's first name and the link state only", async () => {
      prisma.parentalConsent.findUnique.mockResolvedValue(record);

      await expect(service.lookup("abc", NOW)).resolves.toEqual({
        childFirstName: "Léa",
        state: "PENDING",
        expiresAt: FUTURE,
        grantedAt: null,
        revokedAt: null,
      });
    });

    it("defaults to the current date", async () => {
      prisma.parentalConsent.findUnique.mockResolvedValue({
        ...record,
        expiresAt: PAST,
      });
      await expect(service.lookup("abc")).resolves.toMatchObject({
        state: "EXPIRED",
      });
    });
  });

  describe("linkState", () => {
    it("maps each stored status", () => {
      expect(linkState("GRANTED", PAST, NOW)).toBe("GRANTED");
      expect(linkState("REVOKED", FUTURE, NOW)).toBe("REVOKED");
      expect(linkState("PENDING", FUTURE, NOW)).toBe("PENDING");
      expect(linkState("PENDING", PAST, NOW)).toBe("EXPIRED");
      expect(linkState("PENDING", NOW, NOW)).toBe("EXPIRED");
    });

    it("refuses any other status", () => {
      expect(() => linkState("SUPERSEDED", FUTURE, NOW)).toThrow(
        BadRequestException,
      );
    });
  });
});
