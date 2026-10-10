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
  it("derives the season from a date-only expiry (end of season)", () => {
    expect(getLicenseSeason("2026-08-31")).toBe("2025/2026");
  });

  it("switches season right after the boundary", () => {
    expect(getLicenseSeason("2026-09-01")).toBe("2026/2027");
  });

  it("accepts a full ISO timestamp and a Date", () => {
    expect(getLicenseSeason("2027-08-31T00:00:00.000Z")).toBe("2026/2027");
    expect(getLicenseSeason(new Date(Date.UTC(2027, 8, 1)))).toBe("2027/2028");
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
  it("shows the real date and its season, no status", () => {
    expect(ffdValidityFields("2027-08-31T12:00:00.000Z")).toEqual({
      validUntil: "31/08/2027",
      validUntilRaw: "2027-08-31T12:00:00.000Z",
      status: undefined,
      season: "2026/2027",
    });
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
