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

  // CGU v2 (#270) : le certificat médical est vérifié par une personne ; une
  // acceptation de la v1 ne vaut pas consentement à cette vérification.
  it("une acceptation des CGU v1 redéclenche la demande (#270)", async () => {
    await AsyncStorage.setItem("cgu_accepted_version", "1");
    expect(await hasAcceptedCgu()).toBe(false);
  });

  it("une ancienne version acceptée redéclenche la demande", async () => {
    await AsyncStorage.setItem("cgu_accepted_version", "0");
    expect(await hasAcceptedCgu()).toBe(false);
  });
});
