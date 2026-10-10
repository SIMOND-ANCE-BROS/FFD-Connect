import {
  nextLicenseSeasonEnd,
  nextLicenseSeasonEndDay,
} from "./license-season";
import { parisEndOfDay, toLicenseQrExpiry } from "./qr/license-qr";

/** 23:59:59.999 on 2027-08-31 in Paris (CEST, UTC+2). */
const SEASON_END_2027 = "2027-08-31T21:59:59.999Z";

/** French display of an instant, in Paris time (what the card and Wallet show). */
const frenchParisDate = (instant: Date): string =>
  instant.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });

describe("license season end (#238)", () => {
  it.each([
    // The bug: an approval at 22:30 UTC kept that time → 01/09 in Paris.
    ["22:30 UTC in winter (23:30 Paris)", "2026-01-15T22:30:00.000Z"],
    ["22:30 UTC in summer (00:30 Paris next day)", "2026-06-15T22:30:00.000Z"],
    ["00:30 Paris time in winter", "2026-02-09T23:30:00.000Z"],
    ["00:30 Paris time in summer", "2026-07-09T22:30:00.000Z"],
    ["midday UTC", "2026-10-10T12:00:00.000Z"],
    // These two only vary `now`: the season end itself is always in summer
    // time (CEST); DST handling of the end-of-day is covered by the
    // parisEndOfDay tests in qr/license-qr.spec.ts.
    ["a `now` on the spring DST switch day", "2026-03-29T01:00:00.000Z"],
    ["a `now` on the autumn DST switch day", "2026-10-25T01:00:00.000Z"],
  ])("an approval at %s ends on 31/08 Paris, last instant", (_label, now) => {
    const end = nextLicenseSeasonEnd(new Date(now));

    expect(end.toISOString()).toBe(SEASON_END_2027);
    expect(toLicenseQrExpiry(end)).toBe("2027-08-31");
    expect(frenchParisDate(end)).toBe("31/08/2027");
    // Wallet expiration = end of the QR day = 1 ms later.
    expect(parisEndOfDay(toLicenseQrExpiry(end)).getTime()).toBe(
      end.getTime() + 1,
    );
  });

  it("uses the Paris calendar year, not the UTC one, on New Year's Eve", () => {
    // 2026-12-31T23:30Z is already 2027-01-01 00:30 in Paris.
    const now = new Date("2026-12-31T23:30:00.000Z");

    expect(nextLicenseSeasonEndDay(now)).toBe("2028-08-31");
    expect(nextLicenseSeasonEnd(now).toISOString()).toBe(
      "2028-08-31T21:59:59.999Z",
    );
  });

  it("does not depend on the time of day of the approval", () => {
    const morning = nextLicenseSeasonEnd(new Date("2026-05-04T05:00:00.000Z"));
    const night = nextLicenseSeasonEnd(new Date("2026-05-04T21:59:00.000Z"));

    expect(morning.getTime()).toBe(night.getTime());
  });

  it("defaults to the current clock", () => {
    jest.useFakeTimers({ now: new Date("2026-08-31T22:30:00.000Z") });
    try {
      // Already 2026-09-01 in Paris → next season end is 2027-08-31.
      expect(nextLicenseSeasonEndDay()).toBe("2027-08-31");
      expect(nextLicenseSeasonEnd().toISOString()).toBe(SEASON_END_2027);
    } finally {
      jest.useRealTimers();
    }
  });
});
