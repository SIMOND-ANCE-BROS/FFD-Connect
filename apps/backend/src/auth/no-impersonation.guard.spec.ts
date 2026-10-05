import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { NoImpersonationGuard } from "./no-impersonation.guard";

function ctx(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe("NoImpersonationGuard", () => {
  const guard = new NoImpersonationGuard();

  it("laisse passer une session normale", () => {
    expect(guard.canActivate(ctx({ userId: "u1", role: "LICENSEE" }))).toBe(
      true,
    );
  });

  it("bloque une session d'impersonation", () => {
    expect(() =>
      guard.canActivate(ctx({ userId: "target", impersonatedBy: "admin-1" })),
    ).toThrow(ForbiddenException);
  });
});
