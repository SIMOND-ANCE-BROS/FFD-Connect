import { BadRequestException, ConflictException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma, UserRole } from "@prisma/client";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import { AuthPasswordService } from "../auth/auth-password.service";
import { EmailService } from "../auth/email.service";
import { PrismaService } from "../prisma/prisma.service";
import { AdminAuditService } from "./admin-audit.service";
import {
  AdminClubAccountsService,
  INVITATION_EXPIRY_HOURS,
} from "./admin-club-accounts.service";

describe("AdminClubAccountsService", () => {
  let service: AdminClubAccountsService;
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock };
  let passwords: { issuePasswordToken: jest.Mock };
  let email: { sendInvitationEmail: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.club.findUnique.mockResolvedValue(null);
    prisma.club.create.mockResolvedValue({
      id: "c-new",
      name: "Club Neuf",
    } as never);
    prisma.user.create.mockResolvedValue({ id: "u-new" } as never);
    audit = { record: jest.fn() };
    passwords = { issuePasswordToken: jest.fn().mockResolvedValue("plain") };
    email = { sendInvitationEmail: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminClubAccountsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AdminAuditService, useValue: audit },
        { provide: AuthPasswordService, useValue: passwords },
        { provide: EmailService, useValue: email },
      ],
    }).compile();
    service = moduleRef.get(AdminClubAccountsService);
  });

  const base = {
    email: " Club@Example.FR ",
    firstName: "Jeanne",
    lastName: "Martin",
  };

  it("creates a new club + CLUB user with a normalised email, audits, then invites", async () => {
    const res = await service.create("admin-1", {
      ...base,
      clubName: " Club Neuf ",
    });

    expect(prisma.club.create).toHaveBeenCalledWith({
      data: { name: "Club Neuf" },
      select: { id: true, name: true },
    });
    const userData = prisma.user.create.mock.calls[0][0].data;
    expect(userData).toMatchObject({
      email: "club@example.fr",
      firstName: "Jeanne",
      lastName: "Martin",
      role: UserRole.CLUB,
      clubId: "c-new",
      clubName: "Club Neuf",
    });
    expect(userData.password).toMatch(/^\$2[aby]\$/);
    expect(audit.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        action: "CLUB_ACCOUNT_CREATE",
        targetType: "USER",
        targetId: "u-new",
        after: {
          email: "club@example.fr",
          clubId: "c-new",
          clubName: "Club Neuf",
          role: "CLUB",
        },
      }),
    );
    expect(passwords.issuePasswordToken).toHaveBeenCalledWith(
      "u-new",
      INVITATION_EXPIRY_HOURS,
    );
    expect(email.sendInvitationEmail).toHaveBeenCalledWith(
      "club@example.fr",
      "plain",
      "Jeanne",
    );
    expect(res).toEqual({
      userId: "u-new",
      clubId: "c-new",
      invitationSent: true,
    });
  });

  it("attaches to an existing club by id", async () => {
    prisma.club.findUnique.mockResolvedValue({
      id: "c1",
      name: "Club A",
    } as never);
    await service.create("admin-1", { ...base, clubId: "c1" });
    expect(prisma.club.create).not.toHaveBeenCalled();
    expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({
      clubId: "c1",
      clubName: "Club A",
    });
  });

  it("409s on an email already used, looked up in normalised form", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "x" } as never);
    await expect(
      service.create("admin-1", { ...base, clubName: "Z" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "club@example.fr" },
      select: { id: true },
    });
  });

  it("409s with the existing club id when the new club name exists", async () => {
    prisma.club.findUnique.mockResolvedValue({
      id: "c1",
      name: "Club A",
    } as never);
    await expect(
      service.create("admin-1", { ...base, clubName: "Club A" }),
    ).rejects.toMatchObject({
      response: { existingClubId: "c1" },
    });
  });

  it("400s when both or neither of clubId / clubName are given", async () => {
    await expect(service.create("admin-1", { ...base })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.create("admin-1", { ...base, clubId: "c1", clubName: "A" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("keeps the account and reports invitationSent=false when the email fails", async () => {
    email.sendInvitationEmail.mockRejectedValue(new Error("down"));
    const res = await service.create("admin-1", {
      ...base,
      clubName: "Club Neuf",
    });
    expect(res.invitationSent).toBe(false);
    expect(prisma.user.create).toHaveBeenCalled();
  });

  describe("concurrent duplicates (P2002)", () => {
    const p2002 = (target: string[]) =>
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "x",
        meta: { target },
      });

    it("maps an email race to a 409", async () => {
      prisma.user.create.mockRejectedValue(p2002(["email"]));
      await expect(
        service.create("admin-1", { ...base, clubName: "Club Neuf" }),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          message: "Cet email est déjà utilisé",
        }),
      });
    });

    it("maps a club-name race to a 409 carrying existingClubId", async () => {
      prisma.club.create.mockRejectedValue(p2002(["name"]));
      prisma.club.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "c9", name: "Club Neuf" } as never);
      await expect(
        service.create("admin-1", { ...base, clubName: "Club Neuf" }),
      ).rejects.toMatchObject({
        status: 409,
        response: {
          message: "Un club porte déjà ce nom",
          existingClubId: "c9",
        },
      });
    });

    it("rethrows anything that is not a P2002", async () => {
      const boom = new Error("db down");
      prisma.user.create.mockRejectedValue(boom);
      await expect(
        service.create("admin-1", { ...base, clubName: "Club Neuf" }),
      ).rejects.toBe(boom);
    });
  });

  describe("resendInvitation", () => {
    const clubUser = {
      id: "u1",
      email: "c@x.fr",
      firstName: "J",
      role: UserRole.CLUB,
    };

    it("re-issues a token and audits", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...clubUser,
        lastLoginAt: null,
      } as never);
      const res = await service.resendInvitation("admin-1", "u1");
      expect(passwords.issuePasswordToken).toHaveBeenCalledWith(
        "u1",
        INVITATION_EXPIRY_HOURS,
      );
      expect(audit.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          action: "INVITATION_RESEND",
          targetId: "u1",
        }),
      );
      expect(res).toEqual({ invitationSent: true });
    });

    it("400s for a non-CLUB account, without auditing or mailing", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...clubUser,
        role: UserRole.LICENSEE,
        lastLoginAt: null,
      } as never);
      await expect(service.resendInvitation("admin-1", "u1")).rejects.toThrow(
        new BadRequestException(
          "Seuls les comptes Club peuvent recevoir une invitation",
        ),
      );
      expect(audit.record).not.toHaveBeenCalled();
      expect(passwords.issuePasswordToken).not.toHaveBeenCalled();
    });

    it("400s once the user has logged in", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...clubUser,
        lastLoginAt: new Date(),
      } as never);
      await expect(
        service.resendInvitation("admin-1", "u1"),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
