/**
 * Musique hors-ligne (#416) — politique « favoris téléchargés » :
 * download des favoris, suppression au retrait, imports jamais touchés.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  deleteAsync,
  downloadAsync,
  getInfoAsync,
  moveAsync,
} from "expo-file-system/legacy";
import {
  downloadToFile,
  getDownloadedSet,
  localTrackUri,
  syncFavoriteDownloads,
} from "../TrackOfflineService";

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
  getInfoAsync: jest.fn(),
  downloadAsync: jest.fn(),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  moveAsync: jest.fn().mockResolvedValue(undefined),
}));

const getInfo = getInfoAsync as jest.Mock;
const download = downloadAsync as jest.Mock;
const del = deleteAsync as jest.Mock;
const move = moveAsync as jest.Mock;
const PART = /\.[0-9a-z]+\.part$/;

const REGISTRY_KEY = "offline_favorite_files_v1";

/** Simule le disque : seuls les fichiers listés existent. */
function diskHas(...files: string[]) {
  getInfo.mockImplementation((uri: string) =>
    Promise.resolve({ exists: files.some((f) => uri.endsWith(f)) }),
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  download.mockResolvedValue({ status: 200, uri: "file:///docs/x" });
  diskHas();
});

describe("syncFavoriteDownloads", () => {
  const samba = {
    filename: "samba.mp3",
    remoteUrl: "https://api/uploads/samba.mp3",
    liked: true,
  };
  const rumba = {
    filename: "rumba.mp3",
    remoteUrl: "https://api/uploads/rumba.mp3",
    liked: false,
  };

  it("télécharge les favoris manquants et les enregistre au registre", async () => {
    await syncFavoriteDownloads([samba, rumba]);

    const partUri = download.mock.calls[0][1] as string;
    expect(download).toHaveBeenCalledWith(samba.remoteUrl, partUri);
    expect(partUri.startsWith(localTrackUri("samba.mp3"))).toBe(true);
    expect(partUri).toMatch(PART);
    // Déplacé sur le chemin final seulement une fois complet.
    expect(move).toHaveBeenCalledWith({
      from: partUri,
      to: localTrackUri("samba.mp3"),
    });
    expect(download).toHaveBeenCalledTimes(1); // pas les non-favoris
    expect(JSON.parse((await AsyncStorage.getItem(REGISTRY_KEY))!)).toEqual([
      "samba.mp3",
    ]);
  });

  it("retirer un favori supprime SA copie locale (registre)", async () => {
    await AsyncStorage.setItem(REGISTRY_KEY, JSON.stringify(["samba.mp3"]));
    diskHas("samba.mp3");

    await syncFavoriteDownloads([{ ...samba, liked: false }, rumba]);

    expect(del).toHaveBeenCalledWith(localTrackUri("samba.mp3"), {
      idempotent: true,
    });
    expect(JSON.parse((await AsyncStorage.getItem(REGISTRY_KEY))!)).toEqual([]);
  });

  it("ne supprime JAMAIS un fichier hors registre (import utilisateur)", async () => {
    // rumba.mp3 existe sur le disque (importée) mais n'est pas au registre
    diskHas("rumba.mp3");

    await syncFavoriteDownloads([samba, rumba]);

    expect(del).not.toHaveBeenCalledWith(
      localTrackUri("rumba.mp3"),
      expect.anything(),
    );
  });

  it("un favori déjà présent (import) n'est ni retéléchargé ni revendiqué", async () => {
    diskHas("samba.mp3");

    await syncFavoriteDownloads([samba]);

    expect(download).not.toHaveBeenCalled();
    // Pas au registre → jamais supprimé même si retiré des favoris ensuite
    expect(JSON.parse((await AsyncStorage.getItem(REGISTRY_KEY))!)).toEqual([]);
  });

  it("un download en erreur HTTP est purgé et sera retenté", async () => {
    download.mockResolvedValue({ status: 404 });

    await syncFavoriteDownloads([samba]);

    const partUri = download.mock.calls[0][1] as string;
    expect(del).toHaveBeenCalledWith(partUri, { idempotent: true });
    expect(move).not.toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem(REGISTRY_KEY))!)).toEqual([]);
  });
});

describe("downloadToFile (.part)", () => {
  it("purges the .part and never touches the final file on a network error", async () => {
    download.mockRejectedValueOnce(new Error("socket closed"));
    await expect(
      downloadToFile("https://x/a.mp3", "file:///c/a.mp3"),
    ).rejects.toThrow("socket closed");
    const partUri = download.mock.calls[0][1] as string;
    expect(partUri).toMatch(PART);
    expect(del).toHaveBeenCalledWith(partUri, { idempotent: true });
    expect(del).not.toHaveBeenCalledWith("file:///c/a.mp3", expect.anything());
    expect(move).not.toHaveBeenCalled();
  });

  it("uses a unique .part per call (stop + immediate restart can't collide)", async () => {
    await downloadToFile("https://x/a.mp3", "file:///c/a.mp3");
    await downloadToFile("https://x/a.mp3", "file:///c/a.mp3");
    expect(download.mock.calls[0][1]).not.toBe(download.mock.calls[1][1]);
  });
});

describe("getDownloadedSet", () => {
  it("recense uniquement les fichiers présents", async () => {
    diskHas("samba.mp3");

    const set = await getDownloadedSet(["samba.mp3", "rumba.mp3"]);

    expect(set.has("samba.mp3")).toBe(true);
    expect(set.has("rumba.mp3")).toBe(false);
  });
});
