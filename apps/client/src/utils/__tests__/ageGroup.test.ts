import {
  ageGroupsMatch,
  isAgeGroupAllowedForEvent,
  normalizeAgeGroup,
} from "../ageGroup";

describe("normalizeAgeGroup", () => {
  it.each([
    ["Adulte", "adulte"],
    ["Adult", "adulte"],
    ["  Senior   II ", "senior ii"],
    ["Juvénile I", "juvenile i"],
    ["Solo Youth", "youth"],
    ["Solo Junior 2", "junior ii"],
    ["Solo Adulte", "adulte"],
    ["Senior", "senior"],
    ["Espoir", "espoir"],
    ["Under 21", "espoir"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeAgeGroup(input)).toBe(expected);
  });

  it("returns an empty string for missing values", () => {
    expect(normalizeAgeGroup(undefined)).toBe("");
    expect(normalizeAgeGroup(null)).toBe("");
    expect(normalizeAgeGroup("   ")).toBe("");
  });
});

describe("ageGroupsMatch", () => {
  it.each([
    ["Adulte", "Adulte"],
    ["Adult", "Adulte"],
    ["adulte", "ADULT"],
    ["Senior", "Senior II"],
    ["Senior IV", "Senior"],
    ["Juvenile II", "Juvénile II"],
    ["Juvénile", "Juvénile I"],
    ["Solo Junior 1", "Junior I"],
    ["Solo Youth", "Youth"],
  ])("%s matches %s", (a, b) => {
    expect(ageGroupsMatch(a, b)).toBe(true);
  });

  it.each([
    ["Senior I", "Senior II"],
    ["Junior I", "Juvénile I"],
    ["Adulte", "Senior"],
    ["Youth", "Adulte"],
    ["Adulte", ""],
    [undefined, "Adulte"],
  ])("%s does not match %s", (a, b) => {
    expect(ageGroupsMatch(a, b)).toBe(false);
  });
});

describe("isAgeGroupAllowedForEvent", () => {
  it.each([
    ["Espoir", "Youth"],
    ["Espoir", "Adulte"],
    ["Espoir", "Adult"],
    ["Under 21", "Youth"],
    ["Espoir", "Espoir"],
    ["Senior", "Senior III"],
    ["Adulte", "Adult"],
  ])("event %s accepts %s", (event, person) => {
    expect(isAgeGroupAllowedForEvent(event, person)).toBe(true);
  });

  it.each([
    ["Espoir", "Junior II"],
    ["Espoir", "Senior I"],
    ["Youth", "Espoir"],
    ["Adulte", "Youth"],
    ["Espoir", undefined],
  ])("event %s rejects %s", (event, person) => {
    expect(isAgeGroupAllowedForEvent(event, person)).toBe(false);
  });
});
