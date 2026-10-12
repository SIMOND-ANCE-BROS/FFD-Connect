import {
  computeLicenseExpiry,
  formatLicenseExpiryCountdown,
} from "../licenseExpiry";

describe("formatLicenseExpiryCountdown", () => {
  it.each([
    [0, "Votre licence expire aujourd'hui"],
    [1, "Votre licence expire dans 1 jour"],
    [12, "Votre licence expire dans 12 jours"],
  ])("formats %i day(s)", (days, expected) => {
    expect(formatLicenseExpiryCountdown(days)).toBe(expected);
  });
});

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

  describe("same-day expiry (#255)", () => {
    // Backend #238: end of August 31 in Europe/Paris (CEST, UTC+2).
    const validUntil = "2027-08-31T21:59:59.999Z";
    const end = new Date(validUntil).getTime();
    const MINUTE = 60 * 1000;
    const HOUR = 60 * MINUTE;

    it("matches the issue repro: expired the morning after", () => {
      expect(
        computeLicenseExpiry(validUntil, new Date("2027-09-01T10:00:00Z")),
      ).toEqual({ status: "expired", days: -1 });
    });

    it.each([
      ["1 minute", MINUTE],
      ["12 hours", 12 * HOUR],
      ["23 hours", 23 * HOUR],
    ])("is expired %s after validUntil, never -0 days", (_label, offset) => {
      const result = computeLicenseExpiry(validUntil, new Date(end + offset));
      expect(result.status).toBe("expired");
      expect(result.days).toBe(-1);
      expect(Object.is(result.days, -0)).toBe(false);
    });

    it("is still 'urgent' at the exact validUntil instant", () => {
      expect(computeLicenseExpiry(validUntil, new Date(end))).toEqual({
        status: "urgent",
        days: 0,
      });
    });

    it("expires today (0 days) on the last day, in Paris time", () => {
      expect(
        computeLicenseExpiry(validUntil, new Date("2027-08-31T08:00:00Z")),
      ).toEqual({ status: "urgent", days: 0 });
    });

    it("is 'urgent' with 1 day left the day before", () => {
      expect(
        computeLicenseExpiry(validUntil, new Date("2027-08-30T12:00:00Z")),
      ).toEqual({ status: "urgent", days: 1 });
    });

    it("counts Paris calendar days late in the evening", () => {
      // 23:30 in Paris on August 30: still 1 day left, not 2.
      expect(
        computeLicenseExpiry(validUntil, new Date("2027-08-30T21:30:00Z")),
      ).toEqual({ status: "urgent", days: 1 });
    });

    it("counts whole Paris days once expired for a while", () => {
      expect(
        computeLicenseExpiry(validUntil, new Date("2027-09-10T10:00:00Z")),
      ).toEqual({ status: "expired", days: -10 });
    });
  });

  describe("validUntil at any hour: valid until the end of its Paris day (#255)", () => {
    // Beta auto-licences: arbitrary hour, here 10:00 in Paris on August 31.
    const anyHour = "2027-08-31T08:00:00Z";

    it("stays 'urgent' (expires today) later the same Paris day", () => {
      expect(
        computeLicenseExpiry(anyHour, new Date("2027-08-31T15:00:00Z")),
      ).toEqual({ status: "urgent", days: 0 });
    });

    it("is expired from the next Paris day", () => {
      // 00:30 in Paris on September 1.
      expect(
        computeLicenseExpiry(anyHour, new Date("2027-08-31T22:30:00Z")),
      ).toEqual({ status: "expired", days: -1 });
    });

    it("does not expire a legacy midnight-UTC date a day early", () => {
      // 02:00 in Paris on August 31: valid for the whole of August 31.
      expect(
        computeLicenseExpiry(
          "2027-08-31T00:00:00Z",
          new Date("2027-08-31T20:00:00Z"),
        ),
      ).toEqual({ status: "urgent", days: 0 });
    });
  });

  describe("daylight saving time", () => {
    it("counts 3 days across the end of DST (October 2027)", () => {
      // End of November 2 in Paris (CET, UTC+1), now October 30 (CEST).
      expect(
        computeLicenseExpiry(
          "2027-11-02T22:59:59.999Z",
          new Date("2027-10-30T10:00:00Z"),
        ),
      ).toEqual({ status: "urgent", days: 3 });
    });

    describe("around the start of DST (March 28, 2027)", () => {
      // End of March 28 in Paris (CEST, UTC+2).
      const validUntil = "2027-03-28T21:59:59.999Z";

      it("has 1 day left at 23:30 in Paris the evening before (CET)", () => {
        expect(
          computeLicenseExpiry(validUntil, new Date("2027-03-27T22:30:00Z")),
        ).toEqual({ status: "urgent", days: 1 });
      });

      it("expires today at 23:30 in Paris on March 28 (CEST)", () => {
        expect(
          computeLicenseExpiry(validUntil, new Date("2027-03-28T21:30:00Z")),
        ).toEqual({ status: "urgent", days: 0 });
      });

      it("is expired at 00:30 in Paris on March 29", () => {
        expect(
          computeLicenseExpiry(validUntil, new Date("2027-03-28T22:30:00Z")),
        ).toEqual({ status: "expired", days: -1 });
      });
    });
  });

  describe("fallback when the runtime cannot format Paris days", () => {
    beforeEach(() => {
      jest
        .spyOn(Date.prototype, "toLocaleDateString")
        .mockReturnValue("not-a-date");
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("counts remaining days to the millisecond", () => {
      expect(
        computeLicenseExpiry(
          "2027-08-31T12:00:00Z",
          new Date("2027-08-29T00:00:00Z"),
        ),
      ).toEqual({ status: "urgent", days: 3 });
    });

    it("is expired right after validUntil, with at most -1 days", () => {
      expect(
        computeLicenseExpiry(
          "2027-08-31T12:00:00Z",
          new Date("2027-08-31T13:00:00Z"),
        ),
      ).toEqual({ status: "expired", days: -1 });
    });
  });
});
