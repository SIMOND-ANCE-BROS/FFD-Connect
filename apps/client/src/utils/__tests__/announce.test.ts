import { AccessibilityInfo, Platform } from "react-native";
import { announce } from "../announce";

describe("announce", () => {
  const originalOS = Platform.OS;
  let announceSpy: jest.SpyInstance;
  let announceWithOptionsSpy: jest.SpyInstance;

  beforeEach(() => {
    // AccessibilityInfo is already a jest mock in the RN preset: reset calls.
    jest.clearAllMocks();
    announceSpy = jest
      .spyOn(AccessibilityInfo, "announceForAccessibility")
      .mockImplementation(() => {});
    announceWithOptionsSpy = jest
      .spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    Platform.OS = originalOS;
    jest.restoreAllMocks();
  });

  it("queues the announcement on iOS so VoiceOver finishes its sentence", () => {
    Platform.OS = "ios";
    announce("  Ajouté à la file  ");
    expect(announceWithOptionsSpy).toHaveBeenCalledWith("Ajouté à la file", {
      queue: true,
    });
    expect(announceSpy).not.toHaveBeenCalled();
  });

  it("uses the plain announcement on Android (TalkBack)", () => {
    Platform.OS = "android";
    announce("Erreur réseau");
    expect(announceSpy).toHaveBeenCalledWith("Erreur réseau");
    expect(announceWithOptionsSpy).not.toHaveBeenCalled();
  });

  it.each([null, undefined, "", "   "])(
    "ignores an empty message (%p)",
    (m) => {
      announce(m);
      expect(announceSpy).not.toHaveBeenCalled();
      expect(announceWithOptionsSpy).not.toHaveBeenCalled();
    },
  );
});
