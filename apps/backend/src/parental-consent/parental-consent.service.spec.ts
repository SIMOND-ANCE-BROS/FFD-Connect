import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { hashToken } from "../utils/token-hash.util";
import { ParentalConsentEmailService } from "./parental-consent-email.service";
import { PARENTAL_CONSENT_CGU_VERSION } from "./parental-consent.policy";
import { ParentalConsentQueryService } from "./parental-consent.query-service";
import {
  PARENTAL_CONSENT_ALREADY_GRANTED_MESSAGE,
  PARENTAL_CONSENT_EMAIL_FAILED_MESSAGE,
  PARENTAL_CONSENT_EXPIRED_MESSAGE,
  PARENTAL_CONSENT_NOT_REQUIRED_MESSAGE,
  PARENTAL_CONSENT_OWN_EMAIL_MESSAGE,
  PARENTAL_CONSENT_REVOKED_MESSAGE,
  parentEmailHash,
  ParentalConsentService,
} from "./parental-consent.service";

const NOW = new Date("2026-10-15T12:00:00Z");
const SEVEN_DAYS_LATER = new Date("2026-10-22T12:00:00Z");
const FUTURE = new Date("2026-10-20T00:00:00Z");
const PAST = new Date("2026-10-01T00:00:00Z");

const minor = {
  id: "u1",
  firstName: "Léa",
  email: "lea@example.com",
  birthDate: new Date("2012-03-01T00:00:00Z"),
};

function makePrisma() {
  const prisma = {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn() },
    parentalConsent: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    licenseRenewalRequest: { updateMany: jest.fn() },
    licenseRenewalDocument: { updateMany: jest.fn() },
  };
  prisma.$transaction.mockImplementation(
    (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
  );
  return prisma;
}

describe("ParentalConsentService (#61)", () => {
  let prisma: ReturnType<typeof makePrisma>;
  let email: { sendConsentRequest: jest.Mock };
  let query: {
    getState: jest.Mock;
    findByToken: jest.Mock;
    lookup: jest.Mock;
  };
  let service: ParentalConsentService;

  beforeEach(() => {
    prisma = makePrisma();
    email = { sendConsentRequest: jest.fn().mockResolvedValue(undefined) };
    query = {
      getState: jest.fn().mockResolvedValue({ state: "PENDING" }),
      findByToken: jest.fn(),
      lookup: jest.fn().mockResolvedValue({ state: "LOOKED_UP" }),
    };
    service = new ParentalConsentService(
      prisma as unknown as PrismaService,
      email as unknown as ParentalConsentEmailService,
      query as unknown as ParentalConsentQueryService,
    );
  });

  describe("parentEmailHash", () => {
    it("hashes the normalised address", () => {
      expect(parentEmailHash("  Parent@Example.com ")).toBe(
        hashToken("parent@example.com"),
      );
    });
  });

  describe("request", () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue(minor);
      prisma.parentalConsent.findFirst.mockResolvedValue(null);
      prisma.parentalConsent.create.mockResolvedValue({ id: "c-new" });
      prisma.parentalConsent.updateMany.mockResolvedValue({ count: 0 });
    });

    it("404s for an unknown user", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.request("u1", "p@example.com", NOW)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("refuses an adult: never subject to the flow", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...minor,
        birthDate: new Date("1990-01-01T00:00:00Z"),
      });
      await expect(service.request("u1", "p@example.com", NOW)).rejects.toThrow(
        new BadRequestException(PARENTAL_CONSENT_NOT_REQUIRED_MESSAGE),
      );
      expect(prisma.parentalConsent.create).not.toHaveBeenCalled();
      expect(email.sendConsentRequest).not.toHaveBeenCalled();
    });

    it("refuses an account of unknown age", async () => {
      prisma.user.findUnique.mockResolvedValue({ ...minor, birthDate: null });
      await expect(service.request("u1", "p@example.com", NOW)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("refuses the minor's own address, whatever its casing", async () => {
      await expect(
        service.request("u1", " LEA@example.com", NOW),
      ).rejects.toThrow(
        new BadRequestException(PARENTAL_CONSENT_OWN_EMAIL_MESSAGE),
      );
    });

    it("refuses when a parent already consented", async () => {
      prisma.parentalConsent.findFirst.mockResolvedValue({ id: "c-granted" });
      await expect(service.request("u1", "p@example.com", NOW)).rejects.toThrow(
        new ConflictException(PARENTAL_CONSENT_ALREADY_GRANTED_MESSAGE),
      );
      expect(prisma.parentalConsent.create).not.toHaveBeenCalled();
    });

    it("replaces a pending request, stores only hashes, and mails the plain token", async () => {
      const result = await service.request("u1", "Parent@Example.com", NOW);

      expect(prisma.parentalConsent.updateMany).toHaveBeenCalledWith({
        where: { userId: "u1", status: "PENDING" },
        data: { status: "SUPERSEDED", supersededAt: NOW },
      });
      const data = prisma.parentalConsent.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        userId: "u1",
        status: "PENDING",
        parentEmailHash: hashToken("parent@example.com"),
        parentEmailMasked: "p***@e***.com",
        cguVersion: PARENTAL_CONSENT_CGU_VERSION,
        requestedAt: NOW,
        expiresAt: SEVEN_DAYS_LATER,
      });
      // Nothing in clear: neither the address nor the token.
      expect(JSON.stringify(data)).not.toContain("parent@example.com");

      const [to, firstName, token] = email.sendConsentRequest.mock.calls[0];
      expect(to).toBe("parent@example.com");
      expect(firstName).toBe("Léa");
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(data.tokenHash).toBe(hashToken(token));
      expect(result).toEqual({ state: "PENDING" });
      expect(query.getState).toHaveBeenCalledWith("u1", NOW);
    });

    it("withdraws the request and answers 503 when the e-mail fails", async () => {
      email.sendConsentRequest.mockRejectedValue(new Error("resend down"));

      await expect(service.request("u1", "p@example.com", NOW)).rejects.toThrow(
        new ServiceUnavailableException(PARENTAL_CONSENT_EMAIL_FAILED_MESSAGE),
      );
      expect(prisma.parentalConsent.updateMany).toHaveBeenLastCalledWith({
        where: { id: "c-new", status: "PENDING" },
        data: { status: "SUPERSEDED", supersededAt: expect.any(Date) },
      });
    });

    it("withdraws the request on a non-Error failure too", async () => {
      email.sendConsentRequest.mockRejectedValue("boom");
      await expect(service.request("u1", "p@example.com", NOW)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it("defaults to the current date", async () => {
      await service.request("u1", "p@example.com");
      const data = prisma.parentalConsent.create.mock.calls[0][0].data;
      expect(data.expiresAt.getTime() - data.requestedAt.getTime()).toBe(
        7 * 24 * 3600 * 1000,
      );
    });
  });

  describe("requestAfterRegistration", () => {
    it("requests the consent", async () => {
      const spy = jest.spyOn(service, "request").mockResolvedValue({} as never);
      await service.requestAfterRegistration("u1", "p@example.com");
      expect(spy).toHaveBeenCalledWith("u1", "p@example.com");
    });

    it.each([new BadRequestException("adult"), "not an error"])(
      "never fails the registration (%s)",
      async (failure) => {
        jest.spyOn(service, "request").mockRejectedValue(failure);
        await expect(
          service.requestAfterRegistration("u1", "p@example.com"),
        ).resolves.toBeUndefined();
      },
    );
  });

  describe("confirm", () => {
    const pending = {
      id: "c1",
      userId: "u1",
      status: "PENDING",
      expiresAt: FUTURE,
    };

    it("grants a pending link with a conditional update, timestamped", async () => {
      query.findByToken.mockResolvedValue(pending);
      prisma.parentalConsent.updateMany.mockResolvedValue({ count: 1 });

      await expect(service.confirm("tok", NOW)).resolves.toEqual({
        state: "LOOKED_UP",
      });
      expect(prisma.parentalConsent.updateMany).toHaveBeenCalledWith({
        where: { id: "c1", status: "PENDING", expiresAt: { gt: NOW } },
        data: { status: "GRANTED", grantedAt: NOW },
      });
      expect(query.lookup).toHaveBeenCalledWith("tok", NOW);
    });

    it("fails when the link changed between the read and the write", async () => {
      query.findByToken.mockResolvedValue(pending);
      prisma.parentalConsent.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.confirm("tok", NOW)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("is idempotent on an already granted link", async () => {
      query.findByToken.mockResolvedValue({ ...pending, status: "GRANTED" });

      await service.confirm("tok", NOW);

      expect(prisma.parentalConsent.updateMany).not.toHaveBeenCalled();
    });

    it("refuses an expired link", async () => {
      query.findByToken.mockResolvedValue({ ...pending, expiresAt: PAST });
      await expect(service.confirm("tok", NOW)).rejects.toThrow(
        new BadRequestException(PARENTAL_CONSENT_EXPIRED_MESSAGE),
      );
      expect(prisma.parentalConsent.updateMany).not.toHaveBeenCalled();
    });

    it("refuses a withdrawn link: a new request is needed", async () => {
      query.findByToken.mockResolvedValue({ ...pending, status: "REVOKED" });
      await expect(service.confirm("tok", NOW)).rejects.toThrow(
        new BadRequestException(PARENTAL_CONSENT_REVOKED_MESSAGE),
      );
    });

    it("defaults to the current date", async () => {
      query.findByToken.mockResolvedValue({
        ...pending,
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.parentalConsent.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.confirm("tok")).resolves.toBeDefined();
    });
  });

  describe("revoke", () => {
    const granted = {
      id: "c1",
      userId: "u1",
      status: "GRANTED",
      expiresAt: PAST,
    };

    beforeEach(() => {
      prisma.parentalConsent.updateMany.mockResolvedValue({ count: 1 });
    });

    it("withdraws a granted consent with a real effect on health data", async () => {
      query.findByToken.mockResolvedValue(granted);

      await service.revoke("tok", NOW);

      expect(prisma.parentalConsent.updateMany).toHaveBeenCalledWith({
        where: { id: "c1", status: { in: ["PENDING", "GRANTED"] } },
        data: { status: "REVOKED", revokedAt: NOW },
      });
      // A renewal awaiting a decision leaves the moderation queue…
      expect(prisma.licenseRenewalRequest.updateMany).toHaveBeenCalledWith({
        where: { userId: "u1", status: "PENDING" },
        data: { status: "DRAFT", submittedAt: null },
      });
      // …and every medical certificate is stripped and due for purge now.
      expect(prisma.licenseRenewalDocument.updateMany).toHaveBeenCalledWith({
        where: {
          type: "MEDICAL_CERTIFICATE",
          request: { userId: "u1" },
        },
        data: { ocrData: Prisma.DbNull, purgeDueAt: NOW },
      });
      expect(query.lookup).toHaveBeenCalledWith("tok", NOW);
    });

    it("declines a pending request without touching any document", async () => {
      query.findByToken.mockResolvedValue({ ...granted, status: "PENDING" });

      await service.revoke("tok", NOW);

      expect(prisma.parentalConsent.updateMany).toHaveBeenCalled();
      expect(prisma.licenseRenewalRequest.updateMany).not.toHaveBeenCalled();
      expect(prisma.licenseRenewalDocument.updateMany).not.toHaveBeenCalled();
    });

    it("is idempotent on an already withdrawn link", async () => {
      query.findByToken.mockResolvedValue({ ...granted, status: "REVOKED" });

      await service.revoke("tok", NOW);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(query.lookup).toHaveBeenCalledWith("tok", NOW);
    });

    it("fails when the link changed concurrently", async () => {
      query.findByToken.mockResolvedValue(granted);
      prisma.parentalConsent.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revoke("tok", NOW)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.licenseRenewalDocument.updateMany).not.toHaveBeenCalled();
    });

    it("defaults to the current date", async () => {
      query.findByToken.mockResolvedValue({ ...granted, status: "PENDING" });
      await expect(service.revoke("tok")).resolves.toBeDefined();
    });
  });
});
