import { fnv1aHash, stableCacheKey } from "../stableHash";

describe("stableHash", () => {
  it("is deterministic and 8 hex chars", () => {
    expect(fnv1aHash("Samba")).toBe(fnv1aHash("Samba"));
    expect(fnv1aHash("Samba")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("matches the FNV-1a reference values", () => {
    expect(fnv1aHash("")).toBe("811c9dc5");
    expect(fnv1aHash("a")).toBe("e40c292c");
  });

  it("distinguishes accented characters", () => {
    expect(fnv1aHash("deuxième")).not.toBe(fnv1aHash("deuxieme"));
  });

  it("includes the length in the cache key", () => {
    expect(stableCacheKey("abc")).toMatch(/_3$/);
  });
});
