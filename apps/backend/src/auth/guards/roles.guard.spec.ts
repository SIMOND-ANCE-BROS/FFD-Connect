import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test, TestingModule } from "@nestjs/testing";
import { UserRole } from "@prisma/client";
import { ROLES_KEY } from "../decorators/roles.decorator";
import { RolesGuard } from "./roles.guard";

const createMockContext = (
  user?: { role: UserRole; roles?: UserRole[] } | null,
): ExecutionContext => {
  const mockHandler = jest.fn();
  const mockClass = jest.fn();
  return {
    getHandler: () => mockHandler,
    getClass: () => mockClass,
    switchToHttp: () => ({
      getRequest: () => ({ user: user ?? undefined }),
    }),
  } as unknown as ExecutionContext;
};

describe("RolesGuard", () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        RolesGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<RolesGuard>(RolesGuard);
    reflector = module.get(Reflector);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await module.close();
  });

  it("should be defined", () => {
    expect(guard).toBeDefined();
  });

  describe("when no roles are required", () => {
    it("should return true when requiredRoles is undefined", () => {
      reflector.getAllAndOverride.mockReturnValue(undefined);
      const context = createMockContext({ role: UserRole.LICENSEE });

      expect(guard.canActivate(context)).toBe(true);
    });

    it("should return true when requiredRoles is an empty array", () => {
      reflector.getAllAndOverride.mockReturnValue([]);
      const context = createMockContext({ role: UserRole.LICENSEE });

      expect(guard.canActivate(context)).toBe(true);
    });

    it("should return true even when there is no user on the request", () => {
      reflector.getAllAndOverride.mockReturnValue(undefined);
      const context = createMockContext(null);

      expect(guard.canActivate(context)).toBe(true);
    });

    it("should use ROLES_KEY to retrieve metadata from reflector", () => {
      reflector.getAllAndOverride.mockReturnValue(undefined);
      const context = createMockContext({ role: UserRole.LICENSEE });

      guard.canActivate(context);

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [
        expect.any(Function),
        expect.any(Function),
      ]);
    });
  });

  describe("when roles are required", () => {
    it("should return true when user has the required role", () => {
      reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
      const context = createMockContext({ role: UserRole.ADMIN });

      expect(guard.canActivate(context)).toBe(true);
    });

    it("should return true when user has one of multiple required roles", () => {
      reflector.getAllAndOverride.mockReturnValue([
        UserRole.ADMIN,
        UserRole.STAFF,
      ]);
      const context = createMockContext({ role: UserRole.STAFF });

      expect(guard.canActivate(context)).toBe(true);
    });

    it("should return true when user has first of multiple required roles", () => {
      reflector.getAllAndOverride.mockReturnValue([
        UserRole.ADMIN,
        UserRole.STAFF,
      ]);
      const context = createMockContext({ role: UserRole.ADMIN });

      expect(guard.canActivate(context)).toBe(true);
    });

    it("should throw ForbiddenException when user lacks the required role", () => {
      reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
      const context = createMockContext({ role: UserRole.LICENSEE });

      expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
    });

    it("should include required roles in ForbiddenException message", () => {
      reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
      const context = createMockContext({ role: UserRole.LICENSEE });

      expect(() => guard.canActivate(context)).toThrow(
        `Permissions insuffisantes. Rôles requis: ${UserRole.ADMIN}`,
      );
    });

    it("should include all required roles in ForbiddenException message when multiple roles are required", () => {
      reflector.getAllAndOverride.mockReturnValue([
        UserRole.ADMIN,
        UserRole.STAFF,
      ]);
      const context = createMockContext({ role: UserRole.LICENSEE });

      expect(() => guard.canActivate(context)).toThrow(
        `Permissions insuffisantes. Rôles requis: ${UserRole.ADMIN}, ${UserRole.STAFF}`,
      );
    });

    it("should return false when there is no user on the request", () => {
      reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
      const context = createMockContext(null);

      expect(guard.canActivate(context)).toBe(false);
    });

    it("should not throw when there is no user — return false instead", () => {
      reflector.getAllAndOverride.mockReturnValue([UserRole.STAFF]);
      const context = createMockContext(null);

      expect(() => guard.canActivate(context)).not.toThrow();
      expect(guard.canActivate(context)).toBe(false);
    });
  });

  it("allows a user whose extra role is required", () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.CLUB]);
    const ctx = createMockContext({
      role: UserRole.LICENSEE,
      roles: [UserRole.LICENSEE, UserRole.CLUB],
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("falls back to the main role when roles are absent", () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    const ctx = createMockContext({ role: UserRole.ADMIN });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
