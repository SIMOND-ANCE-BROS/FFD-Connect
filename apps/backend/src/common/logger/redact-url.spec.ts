import { redactUrl } from "./redact-url";

describe("redactUrl", () => {
  const token = "q3Vw8pZ0nC1rL5xT7yB2mK9dF4hJ6sA0eG3iN8oR1uW";

  it("hides the Wallet pass download token", () => {
    expect(redactUrl(`/api/v1/licenses/wallet/apple/${token}`)).toBe(
      "/api/v1/licenses/wallet/apple/[REDACTED]",
    );
  });

  it("keeps a query string but not the token", () => {
    const out = redactUrl(`/api/v1/licenses/wallet/apple/${token}?a=1`);
    expect(out).toBe("/api/v1/licenses/wallet/apple/[REDACTED]?a=1");
    expect(out).not.toContain(token);
  });

  it("leaves other URLs untouched (including the POST route)", () => {
    expect(redactUrl("/api/v1/licenses/my/wallet/apple")).toBe(
      "/api/v1/licenses/my/wallet/apple",
    );
    expect(redactUrl("/api/v1/users/me")).toBe("/api/v1/users/me");
  });

  it("handles a missing URL", () => {
    expect(redactUrl(undefined)).toBe("");
  });
});
