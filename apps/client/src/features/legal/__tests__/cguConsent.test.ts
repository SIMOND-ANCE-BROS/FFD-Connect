/** Consentement CGU versionné (#424). */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { acceptCgu, CGU_VERSION, hasAcceptedCgu } from "../cguConsent";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("cguConsent", () => {
  it("non accepté par défaut", async () => {
    expect(await hasAcceptedCgu()).toBe(false);
  });

  it("accepté après acceptCgu", async () => {
    await acceptCgu();
    expect(await hasAcceptedCgu()).toBe(true);
    expect(await AsyncStorage.getItem("cgu_accepted_version")).toBe(
      CGU_VERSION,
    );
  });

  it("une ancienne version acceptée redéclenche la demande", async () => {
    await AsyncStorage.setItem("cgu_accepted_version", "0");
    expect(await hasAcceptedCgu()).toBe(false);
  });
});
