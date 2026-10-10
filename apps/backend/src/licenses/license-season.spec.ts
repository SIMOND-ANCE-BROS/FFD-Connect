import {
  grantedLicenseSeasonEnd,
  grantedLicenseSeasonEndDay,
  isLicenseCoveredForRenewal,
} from "./license-season";
import { parisEndOfDay, toLicenseQrExpiry } from "./qr/license-qr";

/** 23:59:59.999 on 2027-08-31 in Paris (CEST, UTC+2). */
const SEASON_END_2027 = "2027-08-31T21:59:59.999Z";
/** 23:59:59.999 on 2028-08-31 in Paris (CEST, UTC+2). */
const SEASON_END_2028 = "2028-08-31T21:59:59.999Z";

/** French display of an instant, in Paris time (what the card and Wallet show). */
const frenchParisDate = (instant: Date): string =>
  instant.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });

describe("license season rule (#250)", () => {
  it.each([
    // Current season: September → June ends on the coming August 31.
    ["15/10/2026 (autumn)", "2026-10-15T10:00:00.000Z", "2027-08-31"],
    ["15/12/2026 (December)", "2026-12-15T10:00:00.000Z", "2027-08-31"],
    ["01/01/2027 00:30 Paris", "2026-12-31T23:30:00.000Z", "2027-08-31"],
    // The bug: a March approval used to run until 31/08/2028.
    ["15/03/2027 (March)", "2027-03-15T10:00:00.000Z", "2027-08-31"],
    ["30/06/2027 23:30 Paris", "2027-06-30T21:30:00.000Z", "2027-08-31"],
    // Summer campaign: July 1 → August 31 covers the next season.
    // 00:30 Paris on July 1 is still June 30 in UTC.
    ["01/07/2027 00:30 Paris", "2027-06-30T22:30:00.000Z", "2028-08-31"],
    ["15/07/2027", "2027-07-15T10:00:00.000Z", "2028-08-31"],
    ["31/08/2027 midday", "2027-08-31T10:00:00.000Z", "2028-08-31"],
    ["31/08/2027 23:30 Paris", "2027-08-31T21:30:00.000Z", "2028-08-31"],
    // New season: same end as the summer campaign that preceded it.
    ["01/09/2027 00:30 Paris", "2027-08-31T22:30:00.000Z", "2028-08-31"],
    ["01/09/2027 midday", "2027-09-01T10:00:00.000Z", "2028-08-31"],
    ["15/12/2027 (December)", "2027-12-15T10:00:00.000Z", "2028-08-31"],
  ])("a license granted on %s ends on %s", (_label, now, expectedDay) => {
    const granted = new Date(now);

    expect(grantedLicenseSeasonEndDay(granted)).toBe(expectedDay);
    expect(toLicenseQrExpiry(grantedLicenseSeasonEnd(granted))).toBe(
      expectedDay,
    );
  });

  it("defaults to the current clock", () => {
    jest.useFakeTimers({ now: new Date("2027-03-15T10:00:00.000Z") });
    try {
      expect(grantedLicenseSeasonEndDay()).toBe("2027-08-31");
      expect(grantedLicenseSeasonEnd().toISOString()).toBe(SEASON_END_2027);
      expect(isLicenseCoveredForRenewal(new Date(SEASON_END_2027))).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("license season end instant (#238)", () => {
  it.each([
    ["22:30 UTC in winter (23:30 Paris)", "2027-01-15T22:30:00.000Z"],
    ["22:30 UTC in spring (00:30 Paris next day)", "2027-05-15T22:30:00.000Z"],
    ["00:30 Paris time in winter", "2027-02-09T23:30:00.000Z"],
    ["midday UTC", "2026-10-10T12:00:00.000Z"],
    // These two only vary `now`: the season end itself is always in summer
    // time (CEST); DST handling of the end-of-day is covered by the
    // parisEndOfDay tests in qr/license-qr.spec.ts.
    ["a `now` on the spring DST switch day", "2027-03-28T01:00:00.000Z"],
    ["a `now` on the autumn DST switch day", "2026-10-25T01:00:00.000Z"],
  ])("a grant at %s ends on 31/08 Paris, last instant", (_label, now) => {
    const end = grantedLicenseSeasonEnd(new Date(now));

    expect(end.toISOString()).toBe(SEASON_END_2027);
    expect(toLicenseQrExpiry(end)).toBe("2027-08-31");
    expect(frenchParisDate(end)).toBe("31/08/2027");
    // Wallet expiration = end of the QR day = 1 ms later.
    expect(parisEndOfDay(toLicenseQrExpiry(end)).getTime()).toBe(
      end.getTime() + 1,
    );
  });

  it("is the last Paris instant of 31/08 for a summer-campaign grant too", () => {
    const end = grantedLicenseSeasonEnd(new Date("2027-07-01T08:00:00.000Z"));

    expect(end.toISOString()).toBe(SEASON_END_2028);
    expect(frenchParisDate(end)).toBe("31/08/2028");
  });

  it("does not depend on the time of day of the grant", () => {
    const morning = grantedLicenseSeasonEnd(
      new Date("2027-05-04T05:00:00.000Z"),
    );
    const night = grantedLicenseSeasonEnd(new Date("2027-05-04T21:59:00.000Z"));

    expect(morning.getTime()).toBe(night.getTime());
  });
});

describe("isLicenseCoveredForRenewal (#250)", () => {
  it.each([
    // A license granted in March runs until this August 31 …
    [
      "ends 31/08/2027, checked in April 2027",
      SEASON_END_2027,
      "2027-04-10T10:00:00.000Z",
      true,
    ],
    [
      "ends 31/08/2027, checked 30/06/2027 23:30 Paris",
      SEASON_END_2027,
      "2027-06-30T21:30:00.000Z",
      true,
    ],
    // … and must be renewable in the summer campaign.
    [
      "ends 31/08/2027, checked 01/07/2027 00:30 Paris",
      SEASON_END_2027,
      "2027-06-30T22:30:00.000Z",
      false,
    ],
    [
      "ends 31/08/2027, checked in August 2027",
      SEASON_END_2027,
      "2027-08-20T10:00:00.000Z",
      false,
    ],
    // Renewed during the summer campaign: nothing more to do.
    [
      "ends 31/08/2028, checked in August 2027",
      SEASON_END_2028,
      "2027-08-20T10:00:00.000Z",
      true,
    ],
    [
      "ends 31/08/2028, checked in October 2027",
      SEASON_END_2028,
      "2027-10-10T10:00:00.000Z",
      true,
    ],
    // Expired at the end of the previous season.
    [
      "ends 31/08/2026, checked in October 2026",
      "2026-08-31T21:59:59.999Z",
      "2026-10-10T10:00:00.000Z",
      false,
    ],
    // Renewed in summer 2026 for 2026-2027, checked during that season.
    [
      "ends 31/08/2027, checked in October 2026",
      SEASON_END_2027,
      "2026-10-10T10:00:00.000Z",
      true,
    ],
    // Stored with a stray time of day on 31/08 (before #238): same Paris day.
    [
      "ends 31/08/2027 08:00 UTC, checked in October 2026",
      "2027-08-31T08:00:00.000Z",
      "2026-10-10T12:00:00.000Z",
      true,
    ],
    // Granted in March 2027 under the old rule (until 31/08/2028).
    [
      "ends 31/08/2028 (old rule), checked in July 2027",
      SEASON_END_2028,
      "2027-07-05T10:00:00.000Z",
      true,
    ],
  ])("a license that %s", (_label, validUntil, now, expected) => {
    expect(
      isLicenseCoveredForRenewal(new Date(validUntil), new Date(now)),
    ).toBe(expected);
  });
});
