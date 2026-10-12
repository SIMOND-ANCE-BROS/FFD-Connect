import { isLicenseExpired, licenseValidityFloor } from "./license-expiry";
import { parisStartOfDay } from "./qr/license-qr";

const at = (iso: string) => new Date(iso);

describe("isLicenseExpired (#384)", () => {
  // 10:00 Paris (CEST, UTC+2) on 2026-10-12.
  const validUntil = at("2026-10-12T08:00:00.000Z");

  it("is valid earlier on the day of validUntil", () => {
    expect(isLicenseExpired(validUntil, at("2026-10-12T06:00:00.000Z"))).toBe(
      false,
    );
  });

  it("is still valid after the time of day of validUntil (23:00 Paris)", () => {
    expect(isLicenseExpired(validUntil, at("2026-10-12T21:00:00.000Z"))).toBe(
      false,
    );
  });

  it("is valid at the last millisecond of the Paris day", () => {
    expect(isLicenseExpired(validUntil, at("2026-10-12T21:59:59.999Z"))).toBe(
      false,
    );
  });

  it("is expired from 00:00 Paris the next day", () => {
    expect(isLicenseExpired(validUntil, at("2026-10-12T22:00:00.000Z"))).toBe(
      true,
    );
    expect(isLicenseExpired(validUntil, at("2026-10-12T22:01:00.000Z"))).toBe(
      true,
    );
  });

  it("reads validUntil as a Paris day, not a UTC day", () => {
    // 2026-08-30T22:00Z is midnight on 2026-08-31 in Paris.
    const midnightParis = at("2026-08-30T22:00:00.000Z");
    expect(
      isLicenseExpired(midnightParis, at("2026-08-31T21:59:59.999Z")),
    ).toBe(false);
    expect(
      isLicenseExpired(midnightParis, at("2026-08-31T22:00:00.000Z")),
    ).toBe(true);
  });

  it("keeps the season-end convention (23:59:59.999 Paris on Aug 31)", () => {
    const seasonEnd = at("2027-08-31T21:59:59.999Z");
    expect(isLicenseExpired(seasonEnd, at("2027-08-31T21:59:59.999Z"))).toBe(
      false,
    );
    expect(isLicenseExpired(seasonEnd, at("2027-08-31T22:00:00.000Z"))).toBe(
      true,
    );
  });

  describe("around DST switches", () => {
    it("spring forward: the Paris day of 2026-03-29 ends at 22:00Z", () => {
      // 10:00 Paris (CEST) on the switch day.
      const springDay = at("2026-03-29T08:00:00.000Z");
      expect(isLicenseExpired(springDay, at("2026-03-29T21:59:59.999Z"))).toBe(
        false,
      );
      expect(isLicenseExpired(springDay, at("2026-03-29T22:00:00.000Z"))).toBe(
        true,
      );
    });

    it("spring forward: the day before ends at 23:00Z (CET)", () => {
      const before = at("2026-03-28T09:00:00.000Z");
      expect(isLicenseExpired(before, at("2026-03-28T22:59:59.999Z"))).toBe(
        false,
      );
      expect(isLicenseExpired(before, at("2026-03-28T23:00:00.000Z"))).toBe(
        true,
      );
    });

    it("fall back: the Paris day of 2026-10-25 ends at 23:00Z", () => {
      const fallDay = at("2026-10-25T09:00:00.000Z");
      expect(isLicenseExpired(fallDay, at("2026-10-25T22:59:59.999Z"))).toBe(
        false,
      );
      expect(isLicenseExpired(fallDay, at("2026-10-25T23:00:00.000Z"))).toBe(
        true,
      );
    });
  });
});

describe("licenseValidityFloor (#384)", () => {
  it("is 00:00 Paris of the current Paris day (CEST)", () => {
    expect(licenseValidityFloor(at("2026-10-12T21:00:00.000Z"))).toEqual(
      at("2026-10-11T22:00:00.000Z"),
    );
  });

  it("is 00:00 Paris of the current Paris day (CET)", () => {
    expect(licenseValidityFloor(at("2026-12-01T10:00:00.000Z"))).toEqual(
      at("2026-11-30T23:00:00.000Z"),
    );
  });

  it("uses the Paris day, not the UTC day, just after Paris midnight", () => {
    // 00:30 Paris on 2026-10-13 is still 2026-10-12 in UTC.
    expect(licenseValidityFloor(at("2026-10-12T22:30:00.000Z"))).toEqual(
      at("2026-10-12T22:00:00.000Z"),
    );
  });

  it("handles DST switch days (midnight is before the switch)", () => {
    // 2026-03-29: midnight is still CET (UTC+1).
    expect(licenseValidityFloor(at("2026-03-29T12:00:00.000Z"))).toEqual(
      at("2026-03-28T23:00:00.000Z"),
    );
    // 2026-10-25: midnight is still CEST (UTC+2).
    expect(licenseValidityFloor(at("2026-10-25T12:00:00.000Z"))).toEqual(
      at("2026-10-24T22:00:00.000Z"),
    );
    // The day after each switch.
    expect(licenseValidityFloor(at("2026-03-30T12:00:00.000Z"))).toEqual(
      at("2026-03-29T22:00:00.000Z"),
    );
    expect(licenseValidityFloor(at("2026-10-26T12:00:00.000Z"))).toEqual(
      at("2026-10-25T23:00:00.000Z"),
    );
  });

  it("is equivalent to isLicenseExpired for every hour across both DST switches", () => {
    const nows = ["2026-03-29T12:00:00.000Z", "2026-10-25T12:00:00.000Z"].map(
      at,
    );
    for (const now of nows) {
      const floor = licenseValidityFloor(now);
      for (let h = -72; h <= 72; h++) {
        const validUntil = new Date(now.getTime() + h * 3_600_000);
        expect(validUntil.getTime() >= floor.getTime()).toBe(
          !isLicenseExpired(validUntil, now),
        );
      }
      // Exact boundary.
      expect(isLicenseExpired(floor, now)).toBe(false);
      expect(isLicenseExpired(new Date(floor.getTime() - 1), now)).toBe(true);
    }
  });
});

describe("parisStartOfDay", () => {
  it("crosses month and year boundaries", () => {
    expect(parisStartOfDay("2026-03-01")).toEqual(
      at("2026-02-28T23:00:00.000Z"),
    );
    expect(parisStartOfDay("2027-01-01")).toEqual(
      at("2026-12-31T23:00:00.000Z"),
    );
  });
});
