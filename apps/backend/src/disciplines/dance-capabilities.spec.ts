// Relative import on purpose: the package itself is not resolvable at runtime
// from the backend (see dance-capabilities.ts), its source is.
import { DANCE_CAPABILITIES } from "../../../../packages/shared/src/discipline";
import {
  isKnownDanceCapability,
  KNOWN_DANCE_CAPABILITIES,
  knownCapabilities,
} from "./dance-capabilities";

describe("dance capabilities (#1022)", () => {
  it("matches the shared list, in the same order", () => {
    expect(KNOWN_DANCE_CAPABILITIES).toEqual([...DANCE_CAPABILITIES]);
  });

  it("recognises known capabilities only (case-sensitive, no prototype keys)", () => {
    expect(isKnownDanceCapability("PASSPORT")).toBe(true);
    expect(isKnownDanceCapability("passport")).toBe(false);
    expect(isKnownDanceCapability("BATTLE")).toBe(false);
    expect(isKnownDanceCapability("toString")).toBe(false);
    expect(isKnownDanceCapability("")).toBe(false);
  });

  describe("knownCapabilities", () => {
    it("keeps known capabilities in stored order", () => {
      expect(knownCapabilities(["PASSPORT", "COUPLE"])).toEqual([
        "PASSPORT",
        "COUPLE",
      ]);
    });

    it("drops unknown values and duplicates", () => {
      expect(
        knownCapabilities(["COUPLE", "BATTLE", "couple", "", "COUPLE", "TEAM"]),
      ).toEqual(["COUPLE", "TEAM"]);
    });

    it("returns an empty list for no capability", () => {
      expect(knownCapabilities([])).toEqual([]);
    });
  });
});
