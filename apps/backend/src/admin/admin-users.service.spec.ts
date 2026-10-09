import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import { AuthTokenService } from "../auth/auth-token.service";
import { PrismaService } from "../prisma/prisma.service";
import { AccountDeletionService } from "../users/account-deletion.service";
import { AdminAuditService } from "./admin-audit.service";
import { AdminUsersQueryService } from "./admin-users.query-service";
import { AdminUsersService } from "./admin-users.service";

const current = {
  id: "u1",
  firstName: "Jeanne",
  lastName: "Martin",
  clubId: "c1",
  clubName: "Club A",
  category: "Latine", // legacy value outside USER_CATEGORIES
  ageGroup: "Adulte",
  passportLevelLatin: null,
  passportLevelStandard: null,
  competitionLevel: null,
  competitionLevelLatin: null,
  competitionLevelStandard: null,
  nationalRanking: 12,
  role: UserRole.LICENSEE,
  extraRoles: [] as UserRole[],
};

describe("AdminUsersService.update", () => {
  let service: AdminUsersService;
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock; recordOp: jest.Mock };
  let query: { detail: jest.Mock };
  let tokens: { revokeAllUserTokens: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
    prisma.user.findUnique.mockResolvedValue(current as never);
    prisma.user.update.mockResolvedValue({} as never);
    audit = { record: jest.fn(), recordOp: jest.fn() };
    query = { detail: jest.fn().mockResolvedValue({ id: "u1" }) };
    tokens = { revokeAllUserTokens: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AdminAuditService, useValue: audit },
        { provide: AdminUsersQueryService, useValue: query },
        { provide: AuthTokenService, useValue: tokens },
        {
          provide: AccountDeletionService,
          useValue: { deleteAccount: jest.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(AdminUsersService);
  });

  it("updates only sent fields and audits the diff, keeping a legacy category", async () => {
    await service.update("admin-1", "u1", { lastName: "Durand" });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { lastName: "Durand" },
      select: { id: true },
    });
    expect(audit.record).toHaveBeenCalledWith(prisma, {
      actorId: "admin-1",
      action: "USER_UPDATE",
      targetType: "USER",
      targetId: "u1",
      before: { lastName: "Martin" },
      after: { lastName: "Durand" },
    });
    expect(query.detail).toHaveBeenCalledWith("u1");
  });

  it("stores a different competition level per discipline", async () => {
    await service.update("admin-1", "u1", {
      competitionLevelLatin: "International",
      competitionLevelStandard: "Débutant",
    });

    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      competitionLevelLatin: "International",
      competitionLevelStandard: "Débutant",
    });
  });

  it("mirrors a legacy single level (older back-office) to both disciplines", async () => {
    await service.update("admin-1", "u1", { competitionLevel: "Avancé" });

    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      competitionLevel: "Avancé",
      competitionLevelLatin: "Avancé",
      competitionLevelStandard: "Avancé",
    });
  });

  it("syncs clubName when clubId changes", async () => {
    prisma.club.findUnique.mockResolvedValue({
      id: "c2",
      name: "Club B",
    } as never);

    await service.update("admin-1", "u1", { clubId: "c2" });

    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      clubId: "c2",
      clubName: "Club B",
    });
  });

  it("clears club and clubName on clubId null, and clears a ranking on null", async () => {
    await service.update("admin-1", "u1", {
      clubId: null,
      nationalRanking: null,
    });

    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      clubId: null,
      clubName: null,
      nationalRanking: null,
    });
  });

  it("refuses to move a user into a disabled club", async () => {
    prisma.club.findUnique.mockResolvedValue({
      id: "c2",
      name: "Club B",
      disabledAt: new Date(),
    } as never);
    await expect(
      service.update("admin-1", "u1", { clubId: "c2" }),
    ).rejects.toMatchObject({ message: "Ce club est désactivé" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("still allows re-saving the current club when it is disabled", async () => {
    prisma.club.findUnique.mockResolvedValue({
      id: "c1",
      name: "Club A",
      disabledAt: new Date(),
    } as never);
    await service.update("admin-1", "u1", { clubId: "c1", nationalRanking: 3 });
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it("rejects an unknown club with 400", async () => {
    prisma.club.findUnique.mockResolvedValue(null);
    await expect(
      service.update("admin-1", "u1", { clubId: "c9" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses an admin changing their own role", async () => {
    await expect(
      service.update("u1", "u1", { role: UserRole.LICENSEE }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows an admin to edit their own other fields", async () => {
    prisma.user.findUnique.mockResolvedValue({
      ...current,
      role: UserRole.ADMIN,
    } as never);
    await service.update("u1", "u1", { firstName: "Gabin" });
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it("404s on unknown user", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.update("admin-1", "nope", { lastName: "X" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("writes nothing and audits nothing when values are unchanged", async () => {
    await service.update("admin-1", "u1", { lastName: "Martin" });
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(query.detail).toHaveBeenCalledWith("u1");
  });

  it("revokes the target's refresh tokens when the role changes", async () => {
    await service.update("admin-1", "u1", { role: UserRole.STAFF });
    expect(tokens.revokeAllUserTokens).toHaveBeenCalledWith("u1");
  });

  it("does not revoke tokens when the role is unchanged", async () => {
    await service.update("admin-1", "u1", { role: UserRole.LICENSEE });
    expect(tokens.revokeAllUserTokens).not.toHaveBeenCalled();
  });

  it("does not revoke tokens when the role is absent", async () => {
    await service.update("admin-1", "u1", { lastName: "Durand" });
    expect(tokens.revokeAllUserTokens).not.toHaveBeenCalled();
  });

  it("still returns the committed update when the post-commit revocation fails", async () => {
    const warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    tokens.revokeAllUserTokens.mockRejectedValue(new Error("connection reset"));

    await expect(
      service.update("admin-1", "u1", { role: UserRole.STAFF }),
    ).resolves.toEqual({ id: "u1" });

    expect(audit.record).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0] as [string];
    expect(message).toContain("u1");
    expect(message).toContain("connection reset");
    warn.mockRestore();
  });

  describe("extra roles", () => {
    it("stores normalised extra roles and audits them in USER_UPDATE", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...current,
        role: UserRole.LICENSEE,
        extraRoles: [],
        clubId: "c1",
      } as never);
      await service.update("admin-1", "u1", {
        extraRoles: [UserRole.STAFF, UserRole.LICENSEE, UserRole.CLUB],
      });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { extraRoles: [UserRole.CLUB, UserRole.STAFF] },
        }),
      );
      expect(audit.record).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          action: "USER_UPDATE",
          before: { extraRoles: [] },
          after: { extraRoles: [UserRole.CLUB, UserRole.STAFF] },
        }),
      );
    });

    it("drops an extra role that becomes the main role", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...current,
        role: UserRole.LICENSEE,
        extraRoles: [UserRole.CLUB],
        clubId: "c1",
      } as never);
      await service.update("admin-1", "u1", { role: UserRole.CLUB });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { role: UserRole.CLUB, extraRoles: [] },
        }),
      );
    });

    it("lets an admin add an extra role to their own account", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...current,
        id: "admin-1",
        role: UserRole.ADMIN,
        extraRoles: [],
      } as never);
      await expect(
        service.update("admin-1", "admin-1", {
          extraRoles: [UserRole.LICENSEE],
        }),
      ).resolves.toBeDefined();
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it("refuses an admin removing their own ADMIN extra role", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...current,
        id: "admin-1",
        role: UserRole.LICENSEE,
        extraRoles: [UserRole.ADMIN],
      } as never);
      const err = await service
        .update("admin-1", "admin-1", { extraRoles: [] })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as Error).message).toBe(
        "Un administrateur ne peut pas retirer son propre rôle Admin",
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("refuses an extra CLUB role without a club", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...current,
        role: UserRole.LICENSEE,
        extraRoles: [],
        clubId: null,
      } as never);
      const err = await service
        .update("admin-1", "u1", { extraRoles: [UserRole.CLUB] })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toBe(
        "Un rôle Club supplémentaire nécessite un club",
      );
    });

    it("refuses removing the club of an account that keeps an extra CLUB role", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...current,
        role: UserRole.LICENSEE,
        extraRoles: [UserRole.CLUB],
        clubId: "c1",
      } as never);
      await expect(
        service.update("admin-1", "u1", { clubId: null }),
      ).rejects.toThrow("Un rôle Club supplémentaire nécessite un club");
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("writes nothing when the normalised list is unchanged", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...current,
        role: UserRole.LICENSEE,
        extraRoles: [UserRole.STAFF],
      } as never);
      await service.update("admin-1", "u1", {
        extraRoles: [UserRole.STAFF, UserRole.LICENSEE],
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("does not revoke sessions on an extra-role-only change", async () => {
      await service.update("admin-1", "u1", { extraRoles: [UserRole.STAFF] });
      expect(prisma.user.update).toHaveBeenCalled();
      expect(tokens.revokeAllUserTokens).not.toHaveBeenCalled();
    });
  });
});

describe("AdminUsersService.setStatus", () => {
  let service: AdminUsersService;
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock; recordOp: jest.Mock };
  let query: { detail: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    prisma.$transaction.mockImplementation(((fn: (tx: unknown) => unknown) =>
      fn(prisma)) as never);
    prisma.user.update.mockResolvedValue({} as never);
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
    audit = { record: jest.fn(), recordOp: jest.fn() };
    query = { detail: jest.fn().mockResolvedValue({ id: "u1" }) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AdminAuditService, useValue: audit },
        { provide: AdminUsersQueryService, useValue: query },
        {
          provide: AuthTokenService,
          useValue: { revokeAllUserTokens: jest.fn() },
        },
        {
          provide: AccountDeletionService,
          useValue: { deleteAccount: jest.fn() },
        },
      ],
    }).compile();
    service = moduleRef.get(AdminUsersService);
  });

  it("deactivates, revokes every session and audits, in one transaction", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u1",
      disabledAt: null,
    } as never);

    await expect(service.setStatus("admin-1", "u1", false)).resolves.toEqual({
      id: "u1",
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { disabledAt: expect.any(Date) as unknown },
      select: { id: true },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", revoked: false },
      data: { revoked: true, revokedAt: expect.any(Date) as unknown },
    });
    expect(audit.record).toHaveBeenCalledWith(prisma, {
      actorId: "admin-1",
      action: "USER_DISABLE",
      targetType: "USER",
      targetId: "u1",
    });
  });

  it("reactivates without touching sessions", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "u1",
      disabledAt: new Date(),
    } as never);

    await service.setStatus("admin-1", "u1", true);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { disabledAt: null },
      select: { id: true },
    });
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: "USER_ENABLE" }),
    );
  });

  it.each([
    [false, new Date()],
    [true, null],
  ])(
    "is idempotent: active=%s on an account already in that state writes nothing",
    async (active, disabledAt) => {
      prisma.user.findUnique.mockResolvedValue({
        id: "u1",
        disabledAt,
      } as never);

      await expect(service.setStatus("admin-1", "u1", active)).resolves.toEqual(
        { id: "u1" },
      );

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it("refuses the admin's own account before reading anything", async () => {
    await expect(service.setStatus("u1", "u1", false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("404s on an unknown user", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.setStatus("admin-1", "nope", false),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("AdminUsersService.delete", () => {
  let service: AdminUsersService;
  let prisma: MockPrismaService;
  let audit: { record: jest.Mock; recordOp: jest.Mock };
  let deletion: { deleteAccount: jest.Mock };

  beforeEach(async () => {
    prisma = createMockPrismaService();
    prisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "jeanne@x.fr",
      role: UserRole.LICENSEE,
    } as never);
    audit = {
      record: jest.fn(),
      recordOp: jest.fn().mockReturnValue("audit-op"),
    };
    deletion = { deleteAccount: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AdminAuditService, useValue: audit },
        { provide: AdminUsersQueryService, useValue: { detail: jest.fn() } },
        {
          provide: AuthTokenService,
          useValue: { revokeAllUserTokens: jest.fn() },
        },
        { provide: AccountDeletionService, useValue: deletion },
      ],
    }).compile();
    service = moduleRef.get(AdminUsersService);
  });

  it("deletes through the shared core, with a role-only audit row in the same transaction", async () => {
    await service.delete("admin-1", "u1", "jeanne@x.fr");

    expect(audit.recordOp).toHaveBeenCalledWith({
      actorId: "admin-1",
      action: "USER_DELETE",
      targetType: "USER",
      targetId: "u1",
      after: { role: UserRole.LICENSEE },
    });
    expect(deletion.deleteAccount).toHaveBeenCalledWith("u1", ["audit-op"]);
  });

  it("accepts the email whatever its case and surrounding spaces", async () => {
    await service.delete("admin-1", "u1", "  JEANNE@X.fr ");
    expect(deletion.deleteAccount).toHaveBeenCalled();
  });

  it("400s when the typed email does not match, deleting nothing", async () => {
    await expect(service.delete("admin-1", "u1", "paul@x.fr")).rejects.toThrow(
      new BadRequestException("L'email saisi ne correspond pas au compte"),
    );
    expect(deletion.deleteAccount).not.toHaveBeenCalled();
  });

  it("refuses the admin's own account before reading anything", async () => {
    await expect(
      service.delete("u1", "u1", "jeanne@x.fr"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("404s on an unknown user", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.delete("admin-1", "nope", "a@b.fr"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
