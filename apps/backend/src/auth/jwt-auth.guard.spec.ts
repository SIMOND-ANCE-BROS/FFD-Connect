import { JwtAuthGuard } from "./jwt-auth.guard";

describe("JwtAuthGuard", () => {
  it("should be defined with canActivate", () => {
    const guard = new JwtAuthGuard();
    expect(guard).toBeDefined();
    expect(typeof guard.canActivate).toBe("function");
  });
});
