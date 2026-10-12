import {
  DELETED_PARTNER_LABEL,
  findMirrorPartnerUserId,
  isUsableBib,
  MirrorCandidate,
  normalizePersonName,
  personNameMatches,
  readParticipantLabel,
  scrubParticipantLabel,
} from "./partner-name-scrub.utils";

describe("normalizePersonName", () => {
  it("drops diacritics, case and extra spaces", () => {
    expect(normalizePersonName("  Élodie   DUPRÉ ")).toBe("elodie dupre");
  });
});

describe("personNameMatches", () => {
  it.each([
    ["Alex MARTIN", true],
    ["MARTIN Alex", true],
    ["alex  martin", true],
    ["Álex Martín", true],
    ["Alex MARTINEZ", false],
    ["Alex", false],
    ["", false],
    [null, false],
    [undefined, false],
  ])("%p → %p", (label, expected) => {
    expect(personNameMatches(label, "Alex", "MARTIN")).toBe(expected);
  });

  it("never matches an empty first or last name", () => {
    expect(personNameMatches("MARTIN", "", "MARTIN")).toBe(false);
    expect(personNameMatches("Alex", "Alex", " ")).toBe(false);
  });
});

describe("scrubParticipantLabel", () => {
  it.each([
    ["Sam PETIT / Alex MARTIN", "Sam PETIT / Partenaire supprimé"],
    ["Alex MARTIN / Sam PETIT", "Partenaire supprimé / Sam PETIT"],
    ["Sam PETIT & MARTIN Alex", "Sam PETIT & Partenaire supprimé"],
    ["Sam PETIT|Alex MARTIN", "Sam PETIT|Partenaire supprimé"],
    ["Alex MARTIN", DELETED_PARTNER_LABEL],
  ])("%p → %p", (label, expected) => {
    expect(scrubParticipantLabel(label, "Alex", "MARTIN")).toBe(expected);
  });

  it("returns null when no half names the person (left untouched)", () => {
    expect(
      scrubParticipantLabel("Sam PETIT / Lou BLANC", "Alex", "MARTIN"),
    ).toBeNull();
  });

  it("keeps the ranking side untouched: only the name half changes", () => {
    expect(
      scrubParticipantLabel("  Sam PETIT  /  Alex MARTIN ", "Alex", "MARTIN"),
    ).toBe("  Sam PETIT  /  Partenaire supprimé ");
  });
});

describe("readParticipantLabel", () => {
  it("reads a string participant", () => {
    expect(readParticipantLabel({ participant: "A / B", bib: "1" })).toBe(
      "A / B",
    );
  });

  it.each([null, "text", [1], { participant: 3 }, {}])(
    "returns null for %p",
    (details) => {
      expect(readParticipantLabel(details)).toBeNull();
    },
  );
});

describe("isUsableBib", () => {
  it.each([
    [12, true],
    [0, false],
    [-1, false],
    [1.5, false],
    [null, false],
    [undefined, false],
  ])("%p → %p", (bib, expected) => {
    expect(isUsableBib(bib)).toBe(expected);
  });
});

describe("findMirrorPartnerUserId", () => {
  const registration = {
    userId: "u1",
    bibNumber: 12,
    partnerName: "Alex MARTIN",
    firstName: "Sam",
    lastName: "PETIT",
  };
  const mirror = (o: Partial<MirrorCandidate> = {}): MirrorCandidate => ({
    userId: "u2",
    bibNumber: 12,
    partnerName: "Sam PETIT",
    firstName: "Alex",
    lastName: "MARTIN",
    ...o,
  });

  it("links the holder of the reciprocal same-bib registration", () => {
    expect(findMirrorPartnerUserId(registration, [mirror()])).toBe("u2");
  });

  it("accepts a mirror without partnerName (name confirmed one way)", () => {
    expect(
      findMirrorPartnerUserId(registration, [mirror({ partnerName: null })]),
    ).toBe("u2");
  });

  it("ignores the registration's own holder", () => {
    expect(
      findMirrorPartnerUserId(registration, [mirror({ userId: "u1" })]),
    ).toBeNull();
  });

  it("requires the same bib", () => {
    expect(
      findMirrorPartnerUserId(registration, [mirror({ bibNumber: 13 })]),
    ).toBeNull();
  });

  it("requires partnerName to name the mirror's holder", () => {
    expect(
      findMirrorPartnerUserId(registration, [mirror({ firstName: "Lou" })]),
    ).toBeNull();
  });

  it("rejects a mirror whose partnerName names someone else", () => {
    expect(
      findMirrorPartnerUserId(registration, [
        mirror({ partnerName: "Lou BLANC" }),
      ]),
    ).toBeNull();
  });

  it("never links an ambiguous match (two distinct candidates)", () => {
    expect(
      findMirrorPartnerUserId(registration, [
        mirror(),
        mirror({ userId: "u3" }),
      ]),
    ).toBeNull();
  });

  it("links when the same candidate appears twice (e.g. two rounds)", () => {
    expect(findMirrorPartnerUserId(registration, [mirror(), mirror()])).toBe(
      "u2",
    );
  });

  it.each([{ partnerName: null }, { bibNumber: null }, { bibNumber: 0 }])(
    "does not try without a name or a usable bib (%p)",
    (o) => {
      expect(
        findMirrorPartnerUserId({ ...registration, ...o }, [mirror()]),
      ).toBeNull();
    },
  );
});
