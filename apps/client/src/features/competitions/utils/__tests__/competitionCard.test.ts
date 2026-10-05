import {
  deadlineLabel,
  formatParisDate,
  formatParisTime,
  getDeadlineDays,
  getEffectiveCompetitionStatus,
  shouldShowParisLabel,
} from "../competitionCard";

describe("getDeadlineDays", () => {
  // now = Paris 2026-01-01 (UTC 00:00 → Paris 01:00, jour = 1er janvier)
  const now = new Date("2026-01-01T00:00:00Z");

  it("returns null without a deadline", () => {
    expect(getDeadlineDays(undefined, now)).toBeNull();
    expect(getDeadlineDays(null, now)).toBeNull();
  });

  it("returns null for an invalid date", () => {
    expect(getDeadlineDays("pas-une-date", now)).toBeNull();
  });

  it("returns 0 (dernier jour) when the deadline is today in Paris", () => {
    expect(getDeadlineDays("2026-01-01T20:00:00Z", now)).toBe(0);
  });

  it("returns the calendar-day count when within 14 days", () => {
    expect(getDeadlineDays("2026-01-10T12:00:00Z", now)).toBe(9);
  });

  it("returns 14 exactly at the boundary", () => {
    expect(getDeadlineDays("2026-01-15T12:00:00Z", now)).toBe(14);
  });

  it("returns null beyond 14 days", () => {
    expect(getDeadlineDays("2026-01-16T12:00:00Z", now)).toBeNull();
  });

  it("returns null when the deadline day is already past", () => {
    expect(getDeadlineDays("2025-12-31T12:00:00Z", now)).toBeNull();
  });
});

describe("deadlineLabel", () => {
  it("shows 'dernier jour' for 0", () => {
    expect(deadlineLabel(0)).toBe("Inscriptions : dernier jour !");
  });
  it("shows J-X otherwise", () => {
    expect(deadlineLabel(5)).toBe("Inscriptions : J-5");
  });
});

describe("shouldShowParisLabel", () => {
  it("is false when the device is in Paris", () => {
    expect(shouldShowParisLabel("Europe/Paris")).toBe(false);
  });
  it("is true when the device is elsewhere", () => {
    expect(shouldShowParisLabel("America/New_York")).toBe(true);
  });
});

describe("getEffectiveCompetitionStatus", () => {
  const now = new Date("2026-07-17T09:00:00Z"); // aujourd'hui

  it("reclasse un UPCOMING périmé (date passée) en PAST", () => {
    // Le cœur du bug : status stocké UPCOMING mais date dans le passé.
    expect(
      getEffectiveCompetitionStatus("UPCOMING", "2026-07-09T10:00:00Z", now),
    ).toBe("PAST");
  });

  it("garde UPCOMING pour une date future", () => {
    expect(
      getEffectiveCompetitionStatus("UPCOMING", "2026-08-01T10:00:00Z", now),
    ).toBe("UPCOMING");
  });

  it("traite une date d'aujourd'hui comme UPCOMING (pas PAST)", () => {
    expect(
      getEffectiveCompetitionStatus("UPCOMING", "2026-07-17T20:00:00Z", now),
    ).toBe("UPCOMING");
  });

  it("reclasse un PAST stocké mais daté dans le futur en UPCOMING", () => {
    expect(
      getEffectiveCompetitionStatus("PAST", "2026-08-01T10:00:00Z", now),
    ).toBe("UPCOMING");
  });

  it("conserve LIVE quelle que soit la date (signal backend fiable)", () => {
    expect(
      getEffectiveCompetitionStatus("LIVE", "2026-07-09T10:00:00Z", now),
    ).toBe("LIVE");
    expect(
      getEffectiveCompetitionStatus("LIVE", "2026-08-01T10:00:00Z", now),
    ).toBe("LIVE");
  });

  it("retombe sur le statut stocké si la date est absente ou invalide", () => {
    expect(getEffectiveCompetitionStatus("UPCOMING", null, now)).toBe(
      "UPCOMING",
    );
    expect(getEffectiveCompetitionStatus("UPCOMING", "pas-une-date", now)).toBe(
      "UPCOMING",
    );
  });
});

describe("formatParisTime / formatParisDate (always Paris tz)", () => {
  it("formats time in Europe/Paris regardless of the input offset", () => {
    // 12:00 UTC en été = 14:00 à Paris (UTC+2)
    expect(formatParisTime("2026-07-01T12:00:00Z")).toBe("14:00");
  });

  it("uses the Paris calendar day (handles the midnight shift)", () => {
    // 23:30 UTC le 1er juillet = 01:30 le 2 juillet à Paris
    expect(formatParisDate("2026-07-01T23:30:00Z")).toContain("2 juillet 2026");
  });
});
