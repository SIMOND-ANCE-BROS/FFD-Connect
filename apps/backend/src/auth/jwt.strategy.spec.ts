import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { UserRole } from "@prisma/client";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import { PrismaService } from "../prisma/prisma.service";
import { accountStatusSelect } from "../utils/prisma-selects";
import { JwtStrategy } from "./jwt.strategy";

describe("JwtStrategy", () => {
  let prisma: MockPrismaService;
  let strategy: JwtStrategy;
  const payload = {
    sub: "user-1",
    email: "test@example.com",
    role: "LICENSEE",
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    const configService = {
      getOrThrow: jest
        .fn()
        .mockReturnValue("test-secret-32-chars-minimum!!!!!"),
    } as unknown as ConfigService;
    strategy = new JwtStrategy(
      configService,
      prisma as unknown as PrismaService,
    );
  });

  it("maps the payload of an active account, after one status lookup", async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.LICENSEE,
      disabledAt: null,
      club: null,
    } as never);

    await expect(strategy.validate(payload)).resolves.toEqual({
      userId: "user-1",
      email: "test@example.com",
      role: "LICENSEE",
      roles: [UserRole.LICENSEE],
      storeReview: false,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: accountStatusSelect,
    });
  });

  it("rejects a disabled account with 401", async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.LICENSEE,
      disabledAt: new Date(),
      club: null,
    } as never);
    await expect(strategy.validate(payload)).rejects.toThrow(
      new UnauthorizedException("Compte désactivé. Contactez la fédération."),
    );
  });

  it("rejects a CLUB account whose club is disabled", async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.CLUB,
      disabledAt: null,
      club: { disabledAt: new Date() },
    } as never);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("rejects a token whose account no longer exists", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it("returns the database role, not the stale token claim", async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.LICENSEE,
      disabledAt: null,
      club: null,
    } as never);
    await expect(
      strategy.validate({ ...payload, role: "ADMIN" }),
    ).resolves.toMatchObject({ role: UserRole.LICENSEE });
  });

  it("flags the store-review account from the same status lookup", async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.ADMIN,
      extraRoles: [UserRole.LICENSEE, UserRole.CLUB, UserRole.STAFF],
      disabledAt: null,
      isStoreReview: true,
      club: { disabledAt: null },
    } as never);
    await expect(strategy.validate(payload)).resolves.toMatchObject({
      storeReview: true,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  describe("impersonation", () => {
    const imp = { ...payload, impersonatedBy: "admin-1" };
    const target = { role: UserRole.LICENSEE, disabledAt: null, club: null };
    const mockLookups = (impersonator: unknown) =>
      prisma.user.findUnique.mockImplementation((async (args: {
        where: { id: string };
      }) => (args.where.id === "user-1" ? target : impersonator)) as never);

    it("accepts an active ADMIN impersonator", async () => {
      mockLookups({ role: UserRole.ADMIN, disabledAt: null, club: null });
      await expect(strategy.validate(imp)).resolves.toMatchObject({
        userId: "user-1",
        impersonatedBy: "admin-1",
      });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "admin-1" },
        select: accountStatusSelect,
      });
    });

    it("keeps writes simulated in an impersonation opened by the store-review account", async () => {
      mockLookups({
        role: UserRole.ADMIN,
        disabledAt: null,
        isStoreReview: true,
        club: null,
      });
      await expect(strategy.validate(imp)).resolves.toMatchObject({
        userId: "user-1",
        impersonatedBy: "admin-1",
        storeReview: true,
      });
    });

    it("does not flag an impersonation opened by a regular admin", async () => {
      mockLookups({ role: UserRole.ADMIN, disabledAt: null, club: null });
      await expect(strategy.validate(imp)).resolves.toMatchObject({
        storeReview: false,
      });
    });

    it("rejects a disabled impersonator", async () => {
      mockLookups({ role: UserRole.ADMIN, disabledAt: new Date(), club: null });
      await expect(strategy.validate(imp)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("rejects a demoted impersonator", async () => {
      mockLookups({ role: UserRole.LICENSEE, disabledAt: null, club: null });
      await expect(strategy.validate(imp)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("rejects a missing impersonator", async () => {
      mockLookups(null);
      await expect(strategy.validate(imp)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it.each([
      ["main", { role: UserRole.ADMIN, extraRoles: [] }],
      ["extra", { role: UserRole.LICENSEE, extraRoles: [UserRole.ADMIN] }],
    ])(
      "rejects the session once the target holds ADMIN (%s role)",
      async (_label, roles) => {
        prisma.user.findUnique.mockImplementation((async (args: {
          where: { id: string };
        }) =>
          args.where.id === "user-1"
            ? { ...roles, disabledAt: null, club: null }
            : {
                role: UserRole.ADMIN,
                disabledAt: null,
                club: null,
              }) as never);
        await expect(strategy.validate(imp)).rejects.toBeInstanceOf(
          UnauthorizedException,
        );
      },
    );
  });

  describe("impersonation opened by a STAFF actor (#733)", () => {
    const imp = { ...payload, impersonatedBy: "staff-1" };
    const active = { disabledAt: null, club: null };
    const staffActor = { role: UserRole.STAFF, ...active };
    const licenseeTarget = { role: UserRole.LICENSEE, ...active };
    const mockLookups = (target: unknown, impersonator: unknown) =>
      prisma.user.findUnique.mockImplementation((async (args: {
        where: { id: string };
      }) => (args.where.id === "user-1" ? target : impersonator)) as never);

    it.each([
      ["licensee", licenseeTarget],
      ["club", { role: UserRole.CLUB, ...active, club: { disabledAt: null } }],
    ])("accepts the session on a %s target", async (_label, target) => {
      mockLookups(target, staffActor);
      await expect(strategy.validate(imp)).resolves.toMatchObject({
        userId: "user-1",
        impersonatedBy: "staff-1",
        storeReview: false,
      });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: "staff-1" },
        select: accountStatusSelect,
      });
    });

    it("accepts a STAFF role held as an extra role", async () => {
      mockLookups(licenseeTarget, {
        role: UserRole.LICENSEE,
        extraRoles: [UserRole.STAFF],
        ...active,
      });
      await expect(strategy.validate(imp)).resolves.toMatchObject({
        impersonatedBy: "staff-1",
      });
    });

    it("ends the session once the STAFF actor is demoted", async () => {
      mockLookups(licenseeTarget, { role: UserRole.LICENSEE, ...active });
      await expect(strategy.validate(imp)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("ends the session once the STAFF actor is disabled", async () => {
      mockLookups(licenseeTarget, { ...staffActor, disabledAt: new Date() });
      await expect(strategy.validate(imp)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it.each([
      ["STAFF (main role)", { role: UserRole.STAFF, extraRoles: [] }],
      [
        "STAFF (extra role)",
        { role: UserRole.LICENSEE, extraRoles: [UserRole.STAFF] },
      ],
      ["ADMIN (main role)", { role: UserRole.ADMIN, extraRoles: [] }],
      [
        "ADMIN (extra role)",
        { role: UserRole.LICENSEE, extraRoles: [UserRole.ADMIN] },
      ],
    ])("ends the session once the target gains %s", async (_label, roles) => {
      mockLookups({ ...roles, ...active }, staffActor);
      await expect(strategy.validate(imp)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it("lets an ADMIN keep a session on a STAFF target", async () => {
      mockLookups(
        { role: UserRole.STAFF, ...active },
        { role: UserRole.ADMIN, ...active },
      );
      await expect(strategy.validate(imp)).resolves.toMatchObject({
        roles: [UserRole.STAFF],
      });
    });

    it("ends an ADMIN's session on a STAFF target once the admin is demoted to STAFF", async () => {
      mockLookups({ role: UserRole.STAFF, ...active }, staffActor);
      await expect(strategy.validate(imp)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  it("returns every effective role from the database", async () => {
    prisma.user.findUnique.mockResolvedValueOnce({
      role: UserRole.ADMIN,
      extraRoles: [UserRole.LICENSEE],
      disabledAt: null,
      club: null,
    } as never);
    await expect(
      strategy.validate({ sub: "u1", email: "a@x.fr", role: "ADMIN" }),
    ).resolves.toMatchObject({
      role: UserRole.ADMIN,
      roles: [UserRole.ADMIN, UserRole.LICENSEE],
    });
  });

  it("accepts an impersonator whose ADMIN role is an extra role", async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({
        role: UserRole.LICENSEE,
        extraRoles: [],
        disabledAt: null,
        club: null,
      } as never)
      .mockResolvedValueOnce({
        role: UserRole.LICENSEE,
        extraRoles: [UserRole.ADMIN],
        disabledAt: null,
        club: null,
      } as never);
    await expect(
      strategy.validate({
        sub: "t1",
        email: "t@x.fr",
        role: "LICENSEE",
        impersonatedBy: "a1",
      }),
    ).resolves.toMatchObject({ userId: "t1", impersonatedBy: "a1" });
  });
});
