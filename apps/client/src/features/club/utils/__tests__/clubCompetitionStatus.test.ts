import {
  countActiveClubCompetitions,
  displayStatus,
} from "../clubCompetitionStatus";

describe("displayStatus", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  it("keeps a cancelled competition cancelled", () => {
    expect(
      displayStatus({ status: "CANCELLED", date: "2099-01-01" }, now),
    ).toBe("CANCELLED");
  });

  it("keeps LIVE and derives past/upcoming from the date", () => {
    expect(displayStatus({ status: "LIVE", date: "2026-05-30" }, now)).toBe(
      "LIVE",
    );
    expect(displayStatus({ status: "UPCOMING", date: "2026-01-01" }, now)).toBe(
      "PAST",
    );
    expect(displayStatus({ status: "PAST", date: "2026-07-01" }, now)).toBe(
      "UPCOMING",
    );
  });
});

describe("countActiveClubCompetitions", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  it("counts the upcoming and live competitions only", () => {
    expect(
      countActiveClubCompetitions(
        [
          { status: "UPCOMING", date: "2026-07-01" },
          { status: "LIVE", date: "2026-05-30" },
          // Stored as upcoming, but already past by its date.
          { status: "UPCOMING", date: "2026-01-01" },
          { status: "CANCELLED", date: "2026-09-01" },
          { status: "PAST", date: "2025-09-01" },
        ],
        now,
      ),
    ).toBe(2);
  });

  it("is zero for a club without competitions", () => {
    expect(countActiveClubCompetitions([], now)).toBe(0);
  });
});
