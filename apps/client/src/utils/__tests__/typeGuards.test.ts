import {
  isValidCompetitionFilter,
  isValidMemberStatus,
  isValidThemePreference,
  isWdsfQrData,
  isQrData,
  hasExtendedTrackData,
  toCompetitionFilter,
  toMemberStatus,
  toThemePreference,
} from "../typeGuards";

describe("typeGuards", () => {
  describe("MemberStatus", () => {
    it("isValidMemberStatus returns true for ACTIVE and INACTIVE", () => {
      expect(isValidMemberStatus("ACTIVE")).toBe(true);
      expect(isValidMemberStatus("INACTIVE")).toBe(true);
    });

    it("isValidMemberStatus returns false for invalid values", () => {
      expect(isValidMemberStatus("PENDING")).toBe(false);
      expect(isValidMemberStatus("")).toBe(false);
    });

    it("toMemberStatus returns value when valid", () => {
      expect(toMemberStatus("ACTIVE")).toBe("ACTIVE");
      expect(toMemberStatus("INACTIVE")).toBe("INACTIVE");
    });

    it("toMemberStatus returns ACTIVE as default when invalid", () => {
      expect(toMemberStatus("unknown")).toBe("ACTIVE");
    });
  });

  describe("ThemePreference", () => {
    it("isValidThemePreference returns true for light, dark, system", () => {
      expect(isValidThemePreference("light")).toBe(true);
      expect(isValidThemePreference("dark")).toBe(true);
      expect(isValidThemePreference("system")).toBe(true);
    });

    it("isValidThemePreference returns false for invalid", () => {
      expect(isValidThemePreference("auto")).toBe(false);
    });

    it("toThemePreference returns value when valid", () => {
      expect(toThemePreference("dark")).toBe("dark");
    });

    it("toThemePreference returns system as default when invalid", () => {
      expect(toThemePreference("invalid")).toBe("system");
    });
  });

  describe("CompetitionFilter", () => {
    it("isValidCompetitionFilter returns true for ALL, OPEN, DRAFT", () => {
      expect(isValidCompetitionFilter("ALL")).toBe(true);
      expect(isValidCompetitionFilter("OPEN")).toBe(true);
      expect(isValidCompetitionFilter("DRAFT")).toBe(true);
    });

    it("toCompetitionFilter returns value when valid", () => {
      expect(toCompetitionFilter("OPEN")).toBe("OPEN");
      expect(toCompetitionFilter("DRAFT")).toBe("DRAFT");
    });

    it("toCompetitionFilter returns ALL as default when invalid", () => {
      expect(toCompetitionFilter("custom")).toBe("ALL");
    });
  });

  describe("QrData", () => {
    it("isWdsfQrData returns true for valid WDSF QR data", () => {
      expect(isWdsfQrData({ type: "WDSF", id: "12345" })).toBe(true);
    });

    it("isWdsfQrData returns false when type is not WDSF", () => {
      expect(isWdsfQrData({ type: "OTHER", id: "123" })).toBe(false);
    });

    it("isWdsfQrData returns false when id is not a string", () => {
      expect(isWdsfQrData({ type: "WDSF", id: 123 })).toBe(false);
    });

    it("isWdsfQrData returns false for null or non-object", () => {
      expect(isWdsfQrData(null)).toBe(false);
      expect(isWdsfQrData("string")).toBe(false);
      expect(isWdsfQrData(undefined)).toBe(false);
    });

    it("isWdsfQrData returns false when type or id is missing", () => {
      expect(isWdsfQrData({ id: "123" })).toBe(false);
      expect(isWdsfQrData({ type: "WDSF" })).toBe(false);
    });

    it("isQrData returns true for non-null objects", () => {
      expect(isQrData({})).toBe(true);
      expect(isQrData({ foo: "bar" })).toBe(true);
    });

    it("isQrData returns false for null and primitives", () => {
      expect(isQrData(null)).toBe(false);
      expect(isQrData("string")).toBe(false);
      expect(isQrData(42)).toBe(false);
    });
  });

  describe("ExtendedTrackData", () => {
    it("hasExtendedTrackData returns true for objects", () => {
      expect(hasExtendedTrackData({ baseBpm: 120 })).toBe(true);
      expect(hasExtendedTrackData({ style: "Waltz" })).toBe(true);
      expect(hasExtendedTrackData({})).toBe(true);
    });

    it("hasExtendedTrackData returns false for null and primitives", () => {
      expect(hasExtendedTrackData(null)).toBe(false);
      expect(hasExtendedTrackData(undefined)).toBe(false);
      expect(hasExtendedTrackData("track")).toBe(false);
    });
  });
});
