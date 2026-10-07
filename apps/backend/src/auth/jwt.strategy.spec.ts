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
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: accountStatusSelect,
    });
  });

  it("keeps the impersonation claim", async () => {
    prisma.user.findUnique.mockResolvedValue({
      role: UserRole.LICENSEE,
      disabledAt: null,
      club: null,
    } as never);
    await expect(
      strategy.validate({ ...payload, impersonatedBy: "admin-1" }),
    ).resolves.toMatchObject({ impersonatedBy: "admin-1" });
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
});
