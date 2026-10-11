import {
  LICENSE_NUMBER_MAX_LENGTH,
  normalizeLicenseNumber,
} from "./license-number.util";

describe("normalizeLicenseNumber", () => {
  it.each([
    ["FFD-123456", "FFD-123456"],
    ["  123456 ", "123456"],
    ["AB 12/34.5", "AB 12/34.5"],
  ])("keeps %j as %j", (input, expected) => {
    expect(normalizeLicenseNumber(input)).toBe(expected);
  });

  it.each([
    [undefined],
    [null],
    [""],
    ["   "],
    ["-123"],
    ["<script>"],
    ["FFD_1"],
    ["x".repeat(LICENSE_NUMBER_MAX_LENGTH + 1)],
  ])("treats %j as unknown", (input) => {
    expect(normalizeLicenseNumber(input)).toBeNull();
  });
});
