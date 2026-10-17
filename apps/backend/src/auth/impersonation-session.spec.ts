import {
  effectiveImpersonationEnd,
  IMPERSONATION_TOKEN_EXPIRY_MINUTES,
} from "./impersonation-session";

describe("effectiveImpersonationEnd (#733)", () => {
  const startedAt = new Date("2026-10-17T10:00:00Z");
  const expiry = new Date("2026-10-17T10:15:00Z");

  it("keeps the 15-minute token lifetime", () => {
    expect(IMPERSONATION_TOKEN_EXPIRY_MINUTES).toBe(15);
  });

  it("returns the stop date of a session stopped before its token expired", () => {
    const endedAt = new Date("2026-10-17T10:03:00Z");
    expect(effectiveImpersonationEnd({ startedAt, endedAt })).toEqual(endedAt);
  });

  it("caps a stop recorded after the expiry at the expiry", () => {
    const endedAt = new Date("2026-10-17T11:00:00Z");
    expect(effectiveImpersonationEnd({ startedAt, endedAt })).toEqual(expiry);
  });

  it("ends a never-stopped session when its token expired", () => {
    expect(
      effectiveImpersonationEnd(
        { startedAt, endedAt: null },
        new Date("2026-10-18T00:00:00Z"),
      ),
    ).toEqual(expiry);
  });

  it("ends it exactly at the expiry instant", () => {
    expect(
      effectiveImpersonationEnd({ startedAt, endedAt: null }, expiry),
    ).toEqual(expiry);
  });

  it("leaves a session still in use without an end", () => {
    expect(
      effectiveImpersonationEnd(
        { startedAt, endedAt: null },
        new Date("2026-10-17T10:14:59Z"),
      ),
    ).toBeNull();
  });

  it("defaults the clock to now", () => {
    expect(
      effectiveImpersonationEnd({ startedAt: new Date(), endedAt: null }),
    ).toBeNull();
  });
});
