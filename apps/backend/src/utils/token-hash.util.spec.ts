import { createHash } from "crypto";
import { hashToken } from "./token-hash.util";

describe("hashToken", () => {
  it("returns the SHA-256 hex digest of the token", () => {
    expect(hashToken("abc")).toBe(
      createHash("sha256").update("abc").digest("hex"),
    );
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never returns the token itself", () => {
    expect(hashToken("plain")).not.toBe("plain");
  });
});
