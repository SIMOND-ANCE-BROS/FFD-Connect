import { ThrottlerUserGuard } from "./throttler-user.guard";

describe("ThrottlerUserGuard", () => {
  let guard: ThrottlerUserGuard;

  beforeEach(() => {
    guard = new ThrottlerUserGuard(null as never, null as never, null as never);
  });

  // getTracker is protected; we call it via type assertion for unit testing
  const getTracker = (req: Record<string, unknown>) =>
    (
      guard as unknown as {
        getTracker(r: Record<string, unknown>): Promise<string>;
      }
    ).getTracker(req);

  describe("getTracker", () => {
    it("returns user:id when user is authenticated", async () => {
      const req = { user: { id: "user-123" } } as Record<string, unknown>;
      const tracker = await getTracker(req);
      expect(tracker).toBe("user:user-123");
    });

    // JwtStrategy.validate peuple req.user avec { userId, email, role,
    // impersonatedBy } : sans lire `userId`, TOUTES les requêtes authentifiées
    // retombaient silencieusement sur la clé IP et le rate limiting per-user
    // annoncé par ce guard n'existait pas.
    it("returns user:userId for a JWT-authenticated request (JwtStrategy shape)", async () => {
      const req = {
        user: { userId: "user-123", email: "a@b.c", role: "USER" },
        ip: "10.0.0.1",
      } as Record<string, unknown>;
      const tracker = await getTracker(req);
      expect(tracker).toBe("user:user-123");
    });

    it("prefers userId over id when both are present", async () => {
      const req = { user: { userId: "from-jwt", id: "legacy" } } as Record<
        string,
        unknown
      >;
      const tracker = await getTracker(req);
      expect(tracker).toBe("user:from-jwt");
    });

    it("returns ip:x-forwarded-for when no user and x-forwarded-for header", async () => {
      const req = {
        headers: { "x-forwarded-for": "192.168.1.1" },
      } as Record<string, unknown>;
      const tracker = await getTracker(req);
      expect(tracker).toBe("ip:192.168.1.1");
    });

    it("returns ip:req.ip when no user and req.ip set", async () => {
      const req = { ip: "10.0.0.1" } as Record<string, unknown>;
      const tracker = await getTracker(req);
      expect(tracker).toBe("ip:10.0.0.1");
    });

    it("returns ip: empty when no user and no ip", async () => {
      const req = {} as Record<string, unknown>;
      const tracker = await getTracker(req);
      expect(tracker).toBe("ip:");
    });

    it("prefers user over ip when both present", async () => {
      const req = {
        user: { id: "auth-user" },
        ip: "10.0.0.1",
        headers: { "x-forwarded-for": "1.2.3.4" },
      } as Record<string, unknown>;
      const tracker = await getTracker(req);
      expect(tracker).toBe("user:auth-user");
    });
  });
});
