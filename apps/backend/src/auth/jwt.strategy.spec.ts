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
