import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
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
  AdminUserAccountsService,
  INVITATION_EXPIRY_HOURS,
} from "./admin-user-accounts.service";
import type { CreateAdminUserDto } from "./dto/admin-user-accounts.dto";

describe("AdminUserAccountsService", () => {
  let service: AdminUserAccountsService;
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
    prisma.adminAuditLog.findFirst.mockResolvedValue({ id: "a1" } as never);
    audit = { record: jest.fn() };
    passwords = { issuePasswordToken: jest.fn().mockResolvedValue("plain") };
    email = { sendInvitationEmail: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminUserAccountsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AdminAuditService, useValue: audit },
        { provide: AuthPasswordService, useValue: passwords },
        { provide: EmailService, useValue: email },
      ],
    }).compile();
    service = moduleRef.get(AdminUserAccountsService);
  });

  const base = {
    email: " Jeanne@Example.FR ",
    firstName: "Jeanne",
    lastName: "Martin",
  };
  const dto = (o: Partial<CreateAdminUserDto>): CreateAdminUserDto => ({
    ...base,
    role: UserRole.LICENSEE,
    ...o,
  });

  it("creates a CLUB account with a new club, audits USER_CREATE, then invites", async () => {
    const res = await service.create(
      "admin-1",
      dto({ role: UserRole.CLUB, clubName: " Club Neuf " }),
    );

    expect(prisma.club.create).toHaveBeenCalledWith({
      data: { name: "Club Neuf" },
      select: { id: true, name: true },
    });
    const userData = prisma.user.create.mock.calls[0][0].data;
    expect(userData).toMatchObject({
      email: "jeanne@example.fr",
      firstName: "Jeanne",
      lastName: "Martin",
      role: UserRole.CLUB,
      clubId: "c-new",
      clubName: "Club Neuf",
    });
    expect(userData.password).toMatch(/^\$2[aby]\$/);
    expect(audit.record).toHaveBeenCalledWith(prisma, {
      actorId: "admin-1",
      action: "USER_CREATE",
      targetType: "USER",
      targetId: "u-new",
      after: {
        email: "jeanne@example.fr",
        role: "CLUB",
        clubId: "c-new",
        clubName: "Club Neuf",
      },
    });
    expect(passwords.issuePasswordToken).toHaveBeenCalledWith(
      "u-new",
      INVITATION_EXPIRY_HOURS,
    );
    expect(email.sendInvitationEmail).toHaveBeenCalledWith(
      "jeanne@example.fr",
      "plain",
      "Jeanne",
      UserRole.CLUB,
    );
    expect(res).toEqual({
      userId: "u-new",
      clubId: "c-new",
      invitationSent: true,
    });
  });

  it("creates a licensee without club, with the profile fields it was given", async () => {
    const res = await service.create(
      "admin-1",
      dto({ category: "Latin", nationalRanking: 12, ageGroup: null }),
    );

    const userData = prisma.user.create.mock.calls[0][0].data;
    expect(userData).toMatchObject({
      role: UserRole.LICENSEE,
      clubId: null,
      clubName: null,
      category: "Latin",
      nationalRanking: 12,
    });
    expect(userData.ageGroup).toBeUndefined();
    expect(audit.record.mock.calls[0][1].after).toEqual({
      email: "jeanne@example.fr",
      role: "LICENSEE",
      category: "Latin",
      nationalRanking: 12,
    });
    expect(email.sendInvitationEmail).toHaveBeenCalledWith(
      "jeanne@example.fr",
      "plain",
      "Jeanne",
      UserRole.LICENSEE,
    );
    expect(res.clubId).toBeNull();
  });

  it("attaches a STAFF account to an existing club by id", async () => {
    prisma.club.findUnique.mockResolvedValue({
      id: "c1",
      name: "Club A",
      disabledAt: null,
    } as never);
    await service.create(
      "admin-1",
      dto({ role: UserRole.STAFF, clubId: "c1" }),
    );
    expect(prisma.club.create).not.toHaveBeenCalled();
    expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({
      role: UserRole.STAFF,
      clubId: "c1",
      clubName: "Club A",
    });
  });

  it.each([
    ["a new club for a non-Club role", { clubName: "Club Neuf" }],
    ["a Club account without club", { role: UserRole.CLUB }],
    [
      "both clubId and clubName",
      { role: UserRole.CLUB, clubId: "c1", clubName: "A" },
    ],
  ] as const)("400s on %s, writing nothing", async (_label, o) => {
    await expect(service.create("admin-1", dto(o))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("400s on a disabled club id, writing nothing", async () => {
    prisma.club.findUnique.mockResolvedValue({
      id: "c1",
      name: "Club A",
      disabledAt: new Date(),
    } as never);
    await expect(
      service.create("admin-1", dto({ role: UserRole.CLUB, clubId: "c1" })),
    ).rejects.toThrow(new BadRequestException("Ce club est désactivé."));
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(email.sendInvitationEmail).not.toHaveBeenCalled();
  });

  it("400s on role ADMIN even if validation was bypassed, writing nothing", async () => {
    await expect(
      service.create("admin-1", {
        ...dto({}),
        role: UserRole.ADMIN as never,
      }),
    ).rejects.toThrow(
      new BadRequestException(
        "Un compte administrateur ne peut pas être créé ici",
      ),
    );
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("400s on an unknown club id", async () => {
    await expect(
      service.create("admin-1", dto({ clubId: "c9" })),
    ).rejects.toThrow(new BadRequestException("Club introuvable"));
  });

  it("409s on an email already used, looked up in normalised form", async () => {
    prisma.user.findUnique.mockResolvedValue({ id: "x" } as never);
    await expect(service.create("admin-1", dto({}))).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "jeanne@example.fr" },
      select: { id: true },
    });
  });

  it("409s with the existing club id when the new club name exists", async () => {
    prisma.club.findUnique.mockResolvedValue({
      id: "c1",
      name: "Club A",
    } as never);
    await expect(
      service.create(
        "admin-1",
        dto({ role: UserRole.CLUB, clubName: "Club A" }),
      ),
    ).rejects.toMatchObject({ response: { existingClubId: "c1" } });
  });

  it("keeps the account and reports invitationSent=false when the email fails", async () => {
    email.sendInvitationEmail.mockRejectedValue(new Error("down"));
    const res = await service.create("admin-1", dto({}));
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
      await expect(service.create("admin-1", dto({}))).rejects.toMatchObject({
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
        service.create(
          "admin-1",
          dto({ role: UserRole.CLUB, clubName: "Club Neuf" }),
        ),
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
      await expect(service.create("admin-1", dto({}))).rejects.toBe(boom);
    });
  });

  describe("resendInvitation", () => {
    const target = {
      id: "u1",
      email: "j@x.fr",
      firstName: "J",
      role: UserRole.LICENSEE,
      lastLoginAt: null,
      disabledAt: null,
      club: null,
    };

    it("re-issues a token for any non-admin role, with that role's wording, and audits", async () => {
      prisma.user.findUnique.mockResolvedValue(target as never);
      const res = await service.resendInvitation("admin-1", "u1");
      expect(passwords.issuePasswordToken).toHaveBeenCalledWith(
        "u1",
        INVITATION_EXPIRY_HOURS,
      );
      expect(email.sendInvitationEmail).toHaveBeenCalledWith(
        "j@x.fr",
        "plain",
        "J",
        UserRole.LICENSEE,
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

    it.each([
      [
        "an ADMIN account",
        { role: UserRole.ADMIN },
        "Un compte administrateur ne reçoit pas d'invitation",
      ],
      [
        "an account that has logged in",
        { lastLoginAt: new Date() },
        "Ce compte s'est déjà connecté",
      ],
      [
        "a disabled account",
        { disabledAt: new Date() },
        "Ce compte est désactivé",
      ],
      [
        "a CLUB account whose club is disabled",
        { role: UserRole.CLUB, club: { disabledAt: new Date() } },
        "Ce club est désactivé.",
      ],
    ])("400s for %s, without auditing or mailing", async (_l, o, message) => {
      prisma.user.findUnique.mockResolvedValue({ ...target, ...o } as never);
      await expect(service.resendInvitation("admin-1", "u1")).rejects.toThrow(
        new BadRequestException(message),
      );
      expect(audit.record).not.toHaveBeenCalled();
      expect(passwords.issuePasswordToken).not.toHaveBeenCalled();
    });

    it("400s for an account not created from the back-office", async () => {
      prisma.user.findUnique.mockResolvedValue(target as never);
      prisma.adminAuditLog.findFirst.mockResolvedValue(null);
      await expect(service.resendInvitation("admin-1", "u1")).rejects.toThrow(
        new BadRequestException(
          "Ce compte n'a pas été créé depuis le back-office.",
        ),
      );
      expect(prisma.adminAuditLog.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ targetId: "u1" }) as unknown,
        }),
      );
      expect(audit.record).not.toHaveBeenCalled();
      expect(passwords.issuePasswordToken).not.toHaveBeenCalled();
    });

    it("re-invites a CLUB account whose club is active", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...target,
        role: UserRole.CLUB,
        club: { disabledAt: null },
      } as never);
      await expect(service.resendInvitation("admin-1", "u1")).resolves.toEqual({
        invitationSent: true,
      });
    });

    it("404s on an unknown user", async () => {
      await expect(
        service.resendInvitation("admin-1", "nope"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
