import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma } from "@prisma/client";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import { EmailService } from "../auth/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { AdminAuditService } from "./admin-audit.service";
import {
  AdminUserIdentifiersService,
  EMAIL_TAKEN,
  LICENSE_NUMBER_TAKEN,
  NO_LICENSE,
  STORE_REVIEW_IDENTIFIERS,
} from "./admin-user-identifiers.service";
import { AdminUsersQueryService } from "./admin-users.query-service";

const current = {
  id: "u1",
  email: "jeanne@x.fr",
  firstName: "Jeanne",
  isStoreReview: false,
  license: { id: "l1", number: "FFD-1" },
};

const p2002 = (target: string[]) =>
  new Prisma.PrismaClientKnownRequestError("dup", {
    code: "P2002",
    clientVersion: "x",
    meta: { target },
  });

describe("AdminUserIdentifiersService", () => {
  let service: AdminUserIdentifiersService;
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let query: { detail: jest.Mock };
  let email: { sendEmailChangedNotice: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
    prisma.user.findUnique.mockResolvedValue(current as never);
    // E-mail lookup (#465): the address is free by default.
    prisma.$queryRaw.mockResolvedValue([] as never);
    prisma.license.findUnique.mockResolvedValue(null);
    audit = { record: jest.fn() };
    query = { detail: jest.fn().mockResolvedValue({ id: "u1" }) };
    email = { sendEmailChangedNotice: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminUserIdentifiersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AdminAuditService, useValue: audit },
        { provide: AdminUsersQueryService, useValue: query },
        { provide: EmailService, useValue: email },
      ],
    }).compile();
    service = moduleRef.get(AdminUserIdentifiersService);
  });

  describe("email change", () => {
    it("writes the email, revokes sessions and pending links, audits old -> new, then tells the old address", async () => {
      await expect(
        service.update("admin-1", "u1", { email: "new@x.fr" }),
      ).resolves.toEqual({ user: { id: "u1" }, previousEmailNotified: true });

      // Any casing of another account's address, the edited one excluded.
      expect(prisma.$queryRaw).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("WHERE id <> $3"),
          values: expect.arrayContaining(["new@x.fr", "u1"]),
        }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: "u1" },
        data: { email: "new@x.fr", emailNormalized: "new@x.fr" },
        select: { id: true },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: "u1", revoked: false },
        data: { revoked: true, revokedAt: expect.any(Date) },
      });
      expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
        where: { userId: "u1", used: false },
        data: { used: true, usedAt: expect.any(Date) },
      });
      expect(prisma.license.update).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(prisma, {
        actorId: "admin-1",
        action: "USER_IDENTIFIERS_UPDATE",
        targetType: "USER",
        targetId: "u1",
        before: { email: "jeanne@x.fr" },
        after: { email: "new@x.fr" },
      });
      expect(email.sendEmailChangedNotice).toHaveBeenCalledWith(
        "jeanne@x.fr",
        "Jeanne",
      );
    });

    it("refuses an email held by another account (case-insensitive lookup) with a 409", async () => {
      prisma.$queryRaw.mockResolvedValue([
        { id: "u2", email: "Taken@x.fr" },
      ] as never);
      await expect(
        service.update("admin-1", "u1", { email: "taken@x.fr" }),
      ).rejects.toEqual(new ConflictException(EMAIL_TAKEN));
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(email.sendEmailChangedNotice).not.toHaveBeenCalled();
    });

    it("ignores a row the database returned that is not the same address (#465)", async () => {
      // Application-side recheck: never a false 409.
      prisma.$queryRaw.mockResolvedValue([
        { id: "u2", email: "other@x.fr" },
      ] as never);
      await expect(
        service.update("admin-1", "u1", { email: "a_b@x.fr" }),
      ).resolves.toEqual({ user: { id: "u1" }, previousEmailNotified: true });
    });

    it("treats the same address in another stored casing as no change", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...current,
        email: "Jeanne@X.fr",
      } as never);
      await expect(
        service.update("admin-1", "u1", { email: "jeanne@x.fr" }),
      ).resolves.toEqual({ user: { id: "u1" }, previousEmailNotified: null });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
      expect(email.sendEmailChangedNotice).not.toHaveBeenCalled();
    });

    it("keeps the committed change when the notice fails, and logs only the user id", async () => {
      email.sendEmailChangedNotice.mockRejectedValue(
        new Error("Failed to send email: invalid recipient jeanne@x.fr"),
      );
      const warn = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);
      await expect(
        service.update("admin-1", "u1", { email: "new@x.fr" }),
      ).resolves.toEqual({ user: { id: "u1" }, previousEmailNotified: false });
      expect(prisma.user.update).toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        "Email-changed notice not sent for user u1: Error",
      );
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toContain("jeanne@x.fr");
      expect(logged).not.toContain("new@x.fr");
      warn.mockRestore();
    });

    it("reports a non-Error mail failure as a failed notice", async () => {
      email.sendEmailChangedNotice.mockRejectedValue("nope");
      const warn = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);
      await expect(
        service.update("admin-1", "u1", { email: "new@x.fr" }),
      ).resolves.toMatchObject({ previousEmailNotified: false });
      expect(warn).toHaveBeenCalledWith(
        "Email-changed notice not sent for user u1: string",
      );
      warn.mockRestore();
    });

    it("logs the error name and code, never the message", async () => {
      const err = Object.assign(new Error("quota for jeanne@x.fr"), {
        code: "rate_limit_exceeded",
      });
      email.sendEmailChangedNotice.mockRejectedValue(err);
      const warn = jest
        .spyOn(Logger.prototype, "warn")
        .mockImplementation(() => undefined);
      await service.update("admin-1", "u1", { email: "new@x.fr" });
      expect(warn).toHaveBeenCalledWith(
        "Email-changed notice not sent for user u1: Error (rate_limit_exceeded)",
      );
      warn.mockRestore();
    });

    it("maps a lost email race (P2002) to the same 409", async () => {
      prisma.user.update.mockRejectedValue(p2002(["email"]));
      await expect(
        service.update("admin-1", "u1", { email: "new@x.fr" }),
      ).rejects.toEqual(new ConflictException(EMAIL_TAKEN));
      expect(email.sendEmailChangedNotice).not.toHaveBeenCalled();
    });
  });

  describe("licence number change", () => {
    it("renames the attached licence in place and audits old -> new, without touching sessions", async () => {
      await expect(
        service.update("admin-1", "u1", { licenseNumber: "FFD-2" }),
      ).resolves.toEqual({ user: { id: "u1" }, previousEmailNotified: null });

      expect(prisma.license.findUnique).toHaveBeenCalledWith({
        where: { number: "FFD-2" },
        select: { id: true },
      });
      expect(prisma.license.update).toHaveBeenCalledWith({
        where: { id: "l1" },
        data: { number: "FFD-2" },
        select: { id: true },
      });
      // #466: the previous number is retired, so a QR bound to the number
      // alone can never designate whoever gets it next.
      expect(prisma.retiredLicenseNumber.upsert).toHaveBeenCalledWith({
        where: { number: "FFD-1" },
        create: { number: "FFD-1", licenseId: "l1" },
        update: { licenseId: "l1", retiredAt: expect.any(Date) },
        select: { number: true },
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(prisma, {
        actorId: "admin-1",
        action: "USER_IDENTIFIERS_UPDATE",
        targetType: "USER",
        targetId: "u1",
        before: { licenseNumber: "FFD-1" },
        after: { licenseNumber: "FFD-2" },
      });
      expect(email.sendEmailChangedNotice).not.toHaveBeenCalled();
    });

    it("refuses a number already held by another licence with a 409", async () => {
      prisma.license.findUnique.mockResolvedValue({ id: "l2" } as never);
      await expect(
        service.update("admin-1", "u1", { licenseNumber: "FFD-2" }),
      ).rejects.toEqual(new ConflictException(LICENSE_NUMBER_TAKEN));
      expect(prisma.license.update).not.toHaveBeenCalled();
      expect(prisma.retiredLicenseNumber.upsert).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("re-retires a number already retired once (rename back and forth)", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...current,
        license: { id: "l1", number: "FFD-3" },
      } as never);
      await service.update("admin-1", "u1", { licenseNumber: "FFD-1" });
      expect(prisma.retiredLicenseNumber.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { number: "FFD-3" } }),
      );
    });

    it("refuses a number on an account without a licence", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...current,
        license: null,
      } as never);
      await expect(
        service.update("admin-1", "u1", { licenseNumber: "FFD-2" }),
      ).rejects.toEqual(new BadRequestException(NO_LICENSE));
    });

    it("maps a lost number race (P2002) to the same 409", async () => {
      prisma.license.update.mockRejectedValue(p2002(["number"]));
      await expect(
        service.update("admin-1", "u1", { licenseNumber: "FFD-2" }),
      ).rejects.toEqual(new ConflictException(LICENSE_NUMBER_TAKEN));
    });

    it("writes nothing when the number is unchanged", async () => {
      await service.update("admin-1", "u1", { licenseNumber: "FFD-1" });
      expect(prisma.license.findUnique).not.toHaveBeenCalled();
      expect(prisma.retiredLicenseNumber.upsert).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  it("changes both identifiers in one audit row", async () => {
    await service.update("admin-1", "u1", {
      email: "new@x.fr",
      licenseNumber: "FFD-2",
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        before: { email: "jeanne@x.fr", licenseNumber: "FFD-1" },
        after: { email: "new@x.fr", licenseNumber: "FFD-2" },
      }),
    );
  });

  it.each([
    [{ email: "new@x.fr" }],
    [{ licenseNumber: "FFD-2" }],
    [{ email: "jeanne@x.fr", licenseNumber: "FFD-1" }],
  ])("locks every identifier of the store-review account (%p)", async (dto) => {
    prisma.user.findUnique.mockResolvedValue({
      ...current,
      isStoreReview: true,
    } as never);
    await expect(service.update("admin-1", "u1", dto)).rejects.toEqual(
      new ForbiddenException(STORE_REVIEW_IDENTIFIERS),
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.license.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.license.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("requires at least one identifier", async () => {
    await expect(service.update("admin-1", "u1", {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses to change the acting admin's own identifiers", async () => {
    await expect(
      service.update("u1", "u1", { email: "new@x.fr" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("404s on an unknown user", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.update("admin-1", "u1", { email: "new@x.fr" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rethrows a unique violation on another column, and any other error", async () => {
    prisma.license.update.mockRejectedValueOnce(p2002(["other"]));
    await expect(
      service.update("admin-1", "u1", { licenseNumber: "FFD-2" }),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

    const boom = new Error("db down");
    prisma.license.update.mockRejectedValueOnce(boom);
    await expect(
      service.update("admin-1", "u1", { licenseNumber: "FFD-2" }),
    ).rejects.toBe(boom);
  });
});
