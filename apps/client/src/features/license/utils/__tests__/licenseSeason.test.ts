import {
  FFD_VALIDITY_UNKNOWN,
  ffdValidityFields,
  formatFfdValidUntil,
  getFfdSeason,
  getLicenseSeason,
} from "../licenseSeason";

describe("getFfdSeason", () => {
  it("puts August 31st in the season that started the previous September", () => {
    expect(getFfdSeason(new Date(2026, 7, 31, 23, 59))).toBe("2025/2026");
  });

  it("starts a new season on September 1st", () => {
    expect(getFfdSeason(new Date(2026, 8, 1, 0, 0))).toBe("2026/2027");
  });

  it("keeps January in the season started the previous year", () => {
    expect(getFfdSeason(new Date(2027, 0, 15))).toBe("2026/2027");
  });

  it("accepts a custom separator", () => {
    expect(getFfdSeason(new Date(2026, 9, 10), "-")).toBe("2026-2027");
  });
});

describe("getLicenseSeason", () => {
  const now = new Date(2026, 9, 10, 12, 0); // 10/10/2026 → season 2026/2027

  it("shows the current season for a still-valid mid-season expiry (2030-12-31)", () => {
    expect(getLicenseSeason("2030-12-31", now)).toBe("2026/2027");
  });

  it("shows the current season for a 'now + 365 days' beta licence", () => {
    expect(getLicenseSeason("2027-10-10T12:00:00.000Z", now)).toBe("2026/2027");
  });

  it("shows the season of the expiry date once the licence has expired", () => {
    expect(getLicenseSeason("2026-08-31", now)).toBe("2025/2026");
    expect(getLicenseSeason("2025-12-31", now)).toBe("2025/2026");
  });

  it("puts an expiry on September 1st in the season it opened", () => {
    const later = new Date(2028, 0, 1);
    expect(getLicenseSeason("2026-09-01", later)).toBe("2026/2027");
    expect(getLicenseSeason(new Date(Date.UTC(2027, 7, 31)), later)).toBe(
      "2026/2027",
    );
  });

  it("uses the real clock by default", () => {
    jest.useFakeTimers({ now: new Date(2027, 8, 2, 9, 0) });
    try {
      expect(getLicenseSeason("2030-12-31")).toBe("2027/2028");
      expect(getLicenseSeason("2027-08-31")).toBe("2026/2027");
    } finally {
      jest.useRealTimers();
    }
  });

  it("returns undefined without a usable date — never an invented season", () => {
    expect(getLicenseSeason(undefined)).toBeUndefined();
    expect(getLicenseSeason(null)).toBeUndefined();
    expect(getLicenseSeason("")).toBeUndefined();
    expect(getLicenseSeason("not-a-date")).toBeUndefined();
  });
});

describe("formatFfdValidUntil", () => {
  it("formats a real expiry date in French", () => {
    expect(formatFfdValidUntil("2027-08-31T12:00:00.000Z")).toBe("31/08/2027");
  });

  it("returns an empty string without a usable date", () => {
    expect(formatFfdValidUntil(undefined)).toBe("");
    expect(formatFfdValidUntil("garbage")).toBe("");
  });
});

describe("ffdValidityFields", () => {
  it("shows the real date and the current season while valid, no status", () => {
    expect(
      ffdValidityFields("2030-12-31T12:00:00.000Z", new Date(2026, 9, 10)),
    ).toEqual({
      validUntil: "31/12/2030",
      validUntilRaw: "2030-12-31T12:00:00.000Z",
      status: undefined,
      season: "2026/2027",
    });
  });

  it("shows the expiry season of an expired licence", () => {
    expect(
      ffdValidityFields("2026-08-31T12:00:00.000Z", new Date(2026, 9, 10))
        .season,
    ).toBe("2025/2026");
  });

  it("shows a neutral status and no date nor season when the date is missing", () => {
    for (const raw of [undefined, null, "", "garbage"]) {
      expect(ffdValidityFields(raw)).toEqual({
        validUntil: "",
        validUntilRaw: undefined,
        status: FFD_VALIDITY_UNKNOWN,
        season: undefined,
      });
    }
  });
});
