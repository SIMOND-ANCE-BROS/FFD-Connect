import { computeLicenseExpiry } from "../licenseExpiry";

describe("computeLicenseExpiry", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("returns 'valid' with null days when date is missing", () => {
    expect(computeLicenseExpiry(null, now)).toEqual({
      status: "valid",
      days: null,
    });
    expect(computeLicenseExpiry("", now)).toEqual({
      status: "valid",
      days: null,
    });
    expect(computeLicenseExpiry(undefined, now)).toEqual({
      status: "valid",
      days: null,
    });
  });

  it("returns 'valid' with null days when date is unparseable", () => {
    expect(computeLicenseExpiry("pas-une-date", now)).toEqual({
      status: "valid",
      days: null,
    });
  });

  it("returns 'valid' (no banner) when expiry is more than 30 days away", () => {
    const result = computeLicenseExpiry("2026-06-01T00:00:00Z", now);
    expect(result.status).toBe("valid");
    expect(result.days).toBeGreaterThan(30);
  });

  it("returns 'warning' when expiry is within 30 days", () => {
    // 2026-01-21 = +20 days
    expect(computeLicenseExpiry("2026-01-21T00:00:00Z", now)).toEqual({
      status: "warning",
      days: 20,
    });
  });

  it("returns 'warning' exactly at the 30-day boundary", () => {
    expect(computeLicenseExpiry("2026-01-31T00:00:00Z", now).status).toBe(
      "warning",
    );
  });

  it("returns 'urgent' when expiry is within 7 days", () => {
    // 2026-01-04 = +3 days
    expect(computeLicenseExpiry("2026-01-04T00:00:00Z", now)).toEqual({
      status: "urgent",
      days: 3,
    });
  });

  it("returns 'urgent' when expiry is today (0 days)", () => {
    expect(computeLicenseExpiry("2026-01-01T00:00:00Z", now)).toEqual({
      status: "urgent",
      days: 0,
    });
  });

  it("returns 'expired' with negative days when already past", () => {
    const result = computeLicenseExpiry("2025-12-01T00:00:00Z", now);
    expect(result.status).toBe("expired");
    expect(result.days).toBeLessThan(0);
  });

  it("accepts a Date instance", () => {
    expect(computeLicenseExpiry(new Date("2026-01-21T00:00:00Z"), now)).toEqual(
      {
        status: "warning",
        days: 20,
      },
    );
  });
});
