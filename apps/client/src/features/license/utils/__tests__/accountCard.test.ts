import {
  ACCOUNT_CLUB_UNKNOWN,
  ACCOUNT_NAME_UNKNOWN,
  buildAccountCard,
} from "../accountCard";

const NOW = new Date(2026, 9, 10);

describe("buildAccountCard (#234)", () => {
  it("builds the STAFF card from the holder, current season, no number", () => {
    expect(
      buildAccountCard(
        "STAFF",
        { firstName: " Marie ", lastName: "Curie", clubName: "Club Lyon" },
        NOW,
      ),
    ).toEqual({
      firstName: "Marie",
      lastName: "Curie",
      licenseNumber: "",
      validUntil: "",
      season: "2026/2027",
      type: "STAFF / ORGANISATEUR",
      structure: "Club Lyon",
      status: "Permanente",
      birthDate: "",
    });
  });

  it("keeps a STAFF card with only a first name", () => {
    const card = buildAccountCard("STAFF", { firstName: "Marie" }, NOW);
    expect(card.firstName).toBe("Marie");
    expect(card.lastName).toBe("");
  });

  it("drops an unparseable birth date instead of showing it", () => {
    const card = buildAccountCard(
      "STAFF",
      { firstName: "Marie", birthDate: "not-a-date" },
      NOW,
    );
    expect(card.birthDate).toBe("");
  });

  it("uses neutral labels when nothing is known", () => {
    expect(buildAccountCard("STAFF", null, NOW)).toMatchObject({
      firstName: "",
      lastName: ACCOUNT_NAME_UNKNOWN,
      structure: undefined,
    });
    expect(buildAccountCard("CLUB", { clubName: "  " }, NOW)).toMatchObject({
      firstName: "",
      lastName: ACCOUNT_CLUB_UNKNOWN,
      status: "Active",
    });
  });
});
