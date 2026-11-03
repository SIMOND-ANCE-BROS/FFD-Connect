/** Consentement CGU versionné (#424), par compte (#894). */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSessionGeneration } from "../../../api/tokenStore";
import { CguApi } from "../../../services/api/cgu-api";
import {
  acceptCgu,
  CGU_VERSION,
  CguSubject,
  needsCguAcceptance,
} from "../cguConsent";

jest.mock("../../../services/api/cgu-api", () => ({
  CguApi: { hasAccepted: jest.fn(), accept: jest.fn() },
}));
jest.mock("../../../api/tokenStore", () => ({
  getSessionGeneration: jest.fn(() => 1),
}));

const hasAccepted = CguApi.hasAccepted as jest.Mock;
const accept = CguApi.accept as jest.Mock;
const generation = getSessionGeneration as jest.Mock;

const guest: CguSubject = { kind: "guest" };
const alice: CguSubject = { kind: "account", id: "alice" };
const bob: CguSubject = { kind: "account", id: "bob" };
const ALICE_KEY = "cgu_accepted_version:account:alice";

/** Lets the background POST of acceptCgu settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  generation.mockReturnValue(1);
  hasAccepted.mockResolvedValue(null);
  accept.mockResolvedValue("saved");
});

describe("cguConsent — invité (appareil)", () => {
  it("demandé par défaut", async () => {
    expect(await needsCguAcceptance(guest)).toBe(true);
    expect(hasAccepted).not.toHaveBeenCalled();
  });

  it("plus demandé après acceptCgu, sans appel serveur", async () => {
    await acceptCgu(guest);
    await flush();
    expect(await needsCguAcceptance(guest)).toBe(false);
    expect(await AsyncStorage.getItem("cgu_accepted_version")).toBe(
      CGU_VERSION,
    );
    expect(accept).not.toHaveBeenCalled();
  });

  // CGU v2 (#270) : une acceptation de la v1 ne vaut pas consentement.
  it.each(["0", "1"])(
    "une acceptation de la v%s redéclenche la demande",
    async (old) => {
      await AsyncStorage.setItem("cgu_accepted_version", old);
      expect(await needsCguAcceptance(guest)).toBe(true);
    },
  );

  it("stockage illisible : ne bloque pas l'app", async () => {
    jest
      .spyOn(AsyncStorage, "getItem")
      .mockRejectedValueOnce(new Error("locked"));
    expect(await needsCguAcceptance(guest)).toBe(false);
  });
});

describe("cguConsent — compte (#894)", () => {
  it("le serveur fait foi : accepté, rien à demander, copie locale mise à jour", async () => {
    hasAccepted.mockResolvedValue(true);
    expect(await needsCguAcceptance(alice)).toBe(false);
    expect(hasAccepted).toHaveBeenCalledWith(CGU_VERSION);
    expect(await AsyncStorage.getItem(ALICE_KEY)).toBe(CGU_VERSION);
  });

  it("le serveur fait foi : jamais accepté par ce compte → demandé", async () => {
    hasAccepted.mockResolvedValue(false);
    expect(await needsCguAcceptance(alice)).toBe(true);
  });

  it("l'acceptation d'un invité ou d'un autre compte sur l'appareil ne vaut pas pour ce compte", async () => {
    await acceptCgu(guest);
    await acceptCgu(alice);
    await flush();
    accept.mockClear();
    hasAccepted.mockResolvedValue(false);
    expect(await needsCguAcceptance(bob)).toBe(true);
    // Même hors ligne : seule la copie de CE compte compte.
    hasAccepted.mockResolvedValue(null);
    expect(await needsCguAcceptance(bob)).toBe(true);
    expect(accept).not.toHaveBeenCalled();
  });

  it("hors ligne : repli sur la copie locale du même compte", async () => {
    expect(await needsCguAcceptance(alice)).toBe(true);
    await acceptCgu(alice);
    await flush();
    hasAccepted.mockResolvedValue(null);
    expect(await needsCguAcceptance(alice)).toBe(false);
  });

  it("acceptCgu enregistre sur l'appareil puis, sans l'attendre, sur le compte", async () => {
    await acceptCgu(alice);
    expect(accept).toHaveBeenCalledWith(CGU_VERSION);
    expect(await AsyncStorage.getItem(ALICE_KEY)).toBe(CGU_VERSION);
    // La clé de l'appareil (invités) n'est pas touchée.
    expect(await AsyncStorage.getItem("cgu_accepted_version")).toBeNull();
  });

  it("acceptCgu n'attend pas un serveur qui ne répond pas", async () => {
    accept.mockReturnValue(new Promise(() => {}));
    await expect(acceptCgu(alice)).resolves.toBeUndefined();
  });

  it("envoi échoué : renvoyé au prochain lancement, sans redemander", async () => {
    accept.mockResolvedValue("failed");
    await acceptCgu(alice);
    await flush();

    accept.mockClear();
    accept.mockResolvedValue("saved");
    hasAccepted.mockResolvedValue(false);
    expect(await needsCguAcceptance(alice)).toBe(false);
    expect(accept).toHaveBeenCalledWith(CGU_VERSION);
  });

  it("renvoi encore échoué : toujours pas redemandé", async () => {
    await AsyncStorage.setItem(ALICE_KEY, CGU_VERSION);
    hasAccepted.mockResolvedValue(false);
    accept.mockResolvedValue("failed");
    expect(await needsCguAcceptance(alice)).toBe(false);
  });

  it("aucun renvoi si l'identité a changé pendant la vérification", async () => {
    await AsyncStorage.setItem(ALICE_KEY, CGU_VERSION);
    hasAccepted.mockImplementation(() => {
      // Alice se déconnecte, Bob se connecte pendant le GET.
      generation.mockReturnValue(2);
      return Promise.resolve(false);
    });
    expect(await needsCguAcceptance(alice, 1)).toBe(false);
    expect(accept).not.toHaveBeenCalled();
  });

  // Le backend est sur une autre version que le texte de l'app (409) : rien
  // n'est enregistré, la question doit revenir.
  it("version refusée par le serveur à l'acceptation : la copie locale est oubliée", async () => {
    accept.mockResolvedValue("stale");
    await acceptCgu(alice);
    await flush();
    expect(await AsyncStorage.getItem(ALICE_KEY)).toBeNull();
    expect(await needsCguAcceptance(alice)).toBe(true);
  });

  it("version refusée au renvoi : redemandé", async () => {
    await AsyncStorage.setItem(ALICE_KEY, CGU_VERSION);
    hasAccepted.mockResolvedValue(false);
    accept.mockResolvedValue("stale");
    expect(await needsCguAcceptance(alice)).toBe(true);
    expect(await AsyncStorage.getItem(ALICE_KEY)).toBeNull();
  });

  it("une ancienne version acceptée localement ne vaut pas, même hors ligne", async () => {
    await AsyncStorage.setItem(ALICE_KEY, "2");
    expect(await needsCguAcceptance(alice)).toBe(true);
    hasAccepted.mockResolvedValue(false);
    expect(await needsCguAcceptance(alice)).toBe(true);
    expect(accept).not.toHaveBeenCalled();
  });

  it("serveur muet et stockage illisible : ne bloque pas l'app", async () => {
    jest
      .spyOn(AsyncStorage, "getItem")
      .mockRejectedValueOnce(new Error("locked"));
    expect(await needsCguAcceptance(alice)).toBe(false);
  });
});
