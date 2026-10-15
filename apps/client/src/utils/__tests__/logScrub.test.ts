import { scrubLogData, scrubText } from "../logScrub";

describe("scrubText (#589)", () => {
  it("removes e-mails, bearer tokens, JWTs and query strings", () => {
    expect(scrubText("user a.b+c@club.fr failed")).toBe("user [email] failed");
    expect(scrubText("Authorization: Bearer abc.def-123")).toBe(
      "Authorization: Bearer [token]",
    );
    expect(scrubText("token eyJhbGc.eyJzdWI.sig_x")).toBe("token [jwt]");
    expect(scrubText("GET /tracks?search=Jane&take=20 → 500")).toBe(
      "GET /tracks?[query] → 500",
    );
  });

  it("leaves ordinary text alone", () => {
    expect(scrubText("Failed to load? retrying /tracks/42")).toBe(
      "Failed to load? retrying /tracks/42",
    );
  });
});

describe("scrubLogData (#589)", () => {
  it("redacts sensitive keys at any depth and scrubs strings", () => {
    expect(
      scrubLogData({
        name: "Jane Doe",
        trackName: "Cha Cha",
        user: { email: "j@d.fr", lastName: "Doe", id: 7 },
        refreshToken: "r",
        password: "p",
        note: "contact j@d.fr",
        list: ["x@y.io"],
      }),
    ).toEqual({
      name: "[redacted]",
      trackName: "Cha Cha",
      user: { email: "[redacted]", lastName: "[redacted]", id: 7 },
      refreshToken: "[redacted]",
      password: "[redacted]",
      note: "contact [email]",
      list: ["[email]"],
    });
  });

  it("reduces errors to name + scrubbed message (no axios config/headers)", () => {
    const err = Object.assign(new Error("failed for j@d.fr"), {
      config: { headers: { Authorization: "Bearer secret" } },
    });
    expect(scrubLogData({ err })).toEqual({
      err: { name: "Error", message: "failed for [email]" },
    });
  });

  it("is bounded in depth and array length, and JSON-safe", () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(scrubLogData(deep)).toEqual({
      a: { b: { c: { d: "[truncated]" } } },
    });
    expect(scrubLogData(Array.from({ length: 50 }, (_, i) => i))).toHaveLength(
      20,
    );
    expect(scrubLogData({ fn: () => 1, big: BigInt(3) })).toEqual({
      fn: undefined,
      big: "3",
    });
    expect(scrubLogData(undefined)).toBeUndefined();
    expect(scrubLogData(null)).toBeNull();
  });
});
