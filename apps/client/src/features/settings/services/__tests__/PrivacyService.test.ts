/**
 * Droits RGPD côté client (#424) — export/partage des données + suppression
 * de compte via le client OpenAPI généré.
 */
import { deleteAsync, writeAsStringAsync } from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { AppState, Platform } from "react-native";
import {
  usersControllerDeleteMyAccount,
  usersControllerExportMyData,
} from "../../../../api/generated/sdk.gen";
import { runSessionEndCleanups } from "../../../../services/sessionCleanup";
import { AuthService } from "../../../auth/services/AuthService";
import {
  deleteExportFile,
  ANDROID_EXPORT_DELETE_DELAY_MS,
  deleteMyAccount,
  exportAndShareMyData,
} from "../PrivacyService";

jest.mock("../../../../api/generated/sdk.gen", () => ({
  usersControllerExportMyData: jest.fn(),
  usersControllerDeleteMyAccount: jest.fn(),
}));

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../auth/services/AuthService", () => ({
  AuthService: {
    getAuthConfig: jest.fn(),
    endDeletedAccountSession: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockGetTokens = jest.fn();
jest.mock("../../../../api/tokenStore", () => ({
  ...jest.requireActual<object>("../../../../api/tokenStore"),
  getTokens: () => mockGetTokens() as unknown,
}));

jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

const EXPORT_URI = "file:///cache/ffd-connect-mes-donnees.json";

const exportMock = usersControllerExportMyData as jest.Mock;
const deleteMock = usersControllerDeleteMyAccount as jest.Mock;
const writeMock = writeAsStringAsync as jest.Mock;
const deleteFileMock = deleteAsync as jest.Mock;
const shareMock = Sharing.shareAsync as jest.Mock;

const originalOS = Platform.OS;
function setPlatform(os: typeof Platform.OS): void {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true });
}

afterEach(() => {
  setPlatform(originalOS);
  jest.useRealTimers();
});

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform("ios");
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
  shareMock.mockResolvedValue(undefined);
  writeMock.mockResolvedValue(undefined);
  deleteFileMock.mockResolvedValue(undefined);
});

describe("exportAndShareMyData", () => {
  it("écrit le JSON dans le cache puis ouvre la feuille de partage", async () => {
    const payload = { format: "ffd-connect-export-v1", data: { id: "u1" } };
    exportMock.mockResolvedValue({ data: payload });

    await exportAndShareMyData();

    const [uri, contents] = writeMock.mock.calls[0];
    expect(uri).toBe(EXPORT_URI);
    expect(JSON.parse(contents)).toEqual(payload);
    expect(shareMock).toHaveBeenCalledWith(
      uri,
      expect.objectContaining({ mimeType: "application/json" }),
    );
  });

  it("supprime le fichier une fois la feuille de partage fermée (#912)", async () => {
    exportMock.mockResolvedValue({ data: { ok: true } });

    await exportAndShareMyData();

    expect(deleteFileMock).toHaveBeenCalledWith(EXPORT_URI, {
      idempotent: true,
    });
    // Deleted after the share sheet, never before.
    expect(deleteFileMock.mock.invocationCallOrder[0]).toBeGreaterThan(
      shareMock.mock.invocationCallOrder[0],
    );
  });

  it("garde le fichier sur Android après un partage réussi (lecture différée de la cible)", async () => {
    exportMock.mockResolvedValue({ data: { ok: true } });
    setPlatform("android");

    await exportAndShareMyData();

    expect(shareMock).toHaveBeenCalled();
    // Purged later (foreground return, launch or session end), not now.
    expect(deleteFileMock).not.toHaveBeenCalled();
  });

  describe("Android: suppression différée au retour au premier plan (#926)", () => {
    let listener: (state: string) => void;
    const remove = jest.fn();

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(0);
      remove.mockClear();
      jest.spyOn(AppState, "addEventListener").mockImplementation(((
        _type: string,
        cb: (state: string) => void,
      ) => {
        listener = cb;
        return { remove };
      }) as never);
      setPlatform("android");
      exportMock.mockResolvedValue({ data: { ok: true } });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("supprime le fichier au retour au premier plan après le délai", async () => {
      await exportAndShareMyData();
      jest.setSystemTime(ANDROID_EXPORT_DELETE_DELAY_MS);

      listener("active");
      await Promise.resolve();

      expect(deleteFileMock).toHaveBeenCalledWith(EXPORT_URI, {
        idempotent: true,
      });
      expect(remove).toHaveBeenCalled();
    });

    it("ne supprime pas avant le délai et reste abonné", async () => {
      await exportAndShareMyData();
      jest.setSystemTime(ANDROID_EXPORT_DELETE_DELAY_MS - 1);

      listener("active");
      await Promise.resolve();

      expect(deleteFileMock).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();

      jest.setSystemTime(ANDROID_EXPORT_DELETE_DELAY_MS + 1);
      listener("active");
      await Promise.resolve();
      expect(deleteFileMock).toHaveBeenCalledTimes(1);
    });

    it("un second export annule la purge différée du premier", async () => {
      await exportAndShareMyData();
      const firstRemove = remove.mock.calls.length;

      await exportAndShareMyData();

      expect(remove.mock.calls.length).toBeGreaterThan(firstRemove);
      jest.setSystemTime(ANDROID_EXPORT_DELETE_DELAY_MS - 1);
      listener("active");
      await Promise.resolve();
      expect(deleteFileMock).not.toHaveBeenCalled();
    });

    it("ignore les passages en arrière-plan", async () => {
      await exportAndShareMyData();
      jest.setSystemTime(ANDROID_EXPORT_DELETE_DELAY_MS * 2);

      listener("background");
      await Promise.resolve();

      expect(deleteFileMock).not.toHaveBeenCalled();
    });

    it("n'échoue pas si le fichier est déjà absent", async () => {
      deleteFileMock.mockRejectedValue(new Error("ENOENT"));
      await exportAndShareMyData();
      jest.setSystemTime(ANDROID_EXPORT_DELETE_DELAY_MS);

      listener("active");
      await Promise.resolve();
      await Promise.resolve();

      expect(remove).toHaveBeenCalled();
    });

    it("se désabonne si la fin de session purge d'abord (filet de sécurité)", async () => {
      await exportAndShareMyData();

      await runSessionEndCleanups();

      expect(deleteFileMock).toHaveBeenCalledWith(EXPORT_URI, {
        idempotent: true,
      });
      expect(remove).toHaveBeenCalled();
    });

    it("n'enregistre aucun écouteur sur iOS", async () => {
      setPlatform("ios");

      await exportAndShareMyData();

      expect(AppState.addEventListener).not.toHaveBeenCalled();
    });
  });

  // expo-sharing resolves when the user dismisses the sheet (covered by the
  // success case above); a rejection is a share failure.
  it("supprime le fichier quand le partage échoue, Android compris (#912)", async () => {
    setPlatform("android");
    exportMock.mockResolvedValue({ data: { ok: true } });
    shareMock.mockRejectedValue(new Error("cancelled"));

    await expect(exportAndShareMyData()).rejects.toThrow("cancelled");
    expect(deleteFileMock).toHaveBeenCalledWith(EXPORT_URI, {
      idempotent: true,
    });
  });

  it("purge un fichier partiellement écrit si l'écriture échoue (#912)", async () => {
    exportMock.mockResolvedValue({ data: { ok: true } });
    writeMock.mockRejectedValue(new Error("disk full"));

    await expect(exportAndShareMyData()).rejects.toThrow("disk full");
    expect(shareMock).not.toHaveBeenCalled();
    expect(deleteFileMock).toHaveBeenCalledWith(EXPORT_URI, {
      idempotent: true,
    });
  });

  it("garde l'erreur du partage si la suppression échoue aussi", async () => {
    exportMock.mockResolvedValue({ data: { ok: true } });
    shareMock.mockRejectedValue(new Error("cancelled"));
    deleteFileMock.mockRejectedValue(new Error("io"));

    await expect(exportAndShareMyData()).rejects.toThrow("cancelled");
  });

  it("échoue sans rien écrire si l'API renvoie une erreur", async () => {
    exportMock.mockResolvedValue({ error: { statusCode: 500 } });

    await expect(exportAndShareMyData()).rejects.toThrow("EXPORT_FAILED");
    expect(writeMock).not.toHaveBeenCalled();
    expect(shareMock).not.toHaveBeenCalled();
  });

  it("échoue sans rien écrire si le partage n'est pas disponible", async () => {
    exportMock.mockResolvedValue({ data: { ok: true } });
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);

    await expect(exportAndShareMyData()).rejects.toThrow("SHARING_UNAVAILABLE");
    expect(writeMock).not.toHaveBeenCalled();
    expect(shareMock).not.toHaveBeenCalled();
  });
});

describe("deleteExportFile", () => {
  it("supprime le fichier d'export de façon idempotente", async () => {
    await deleteExportFile();

    expect(deleteFileMock).toHaveBeenCalledWith(EXPORT_URI, {
      idempotent: true,
    });
  });

  it("ne fait rien sur le web (pas de cache fichier)", async () => {
    setPlatform("web");

    await deleteExportFile();

    expect(deleteFileMock).not.toHaveBeenCalled();
  });

  it("ne lève jamais, même si la suppression échoue", async () => {
    deleteFileMock.mockRejectedValue(new Error("io"));

    await expect(deleteExportFile()).resolves.toBeUndefined();
  });

  it("est exécutée en fin de session (déconnexion, #912)", async () => {
    await runSessionEndCleanups();

    expect(deleteFileMock).toHaveBeenCalledWith(EXPORT_URI, {
      idempotent: true,
    });
  });
});

describe("deleteMyAccount", () => {
  beforeEach(() => {
    mockGetTokens.mockResolvedValue({ authToken: "a", refreshToken: "r" });
  });

  // #933: a confirmed deletion wipes the account's local data, not a plain
  // logout that keeps lastUser, the profile and (biometrics) the tokens.
  it("efface les données locales du compte une fois la suppression confirmée", async () => {
    deleteMock.mockResolvedValue({ data: { message: "ok" }, response: {} });

    await deleteMyAccount("s3cret");

    expect(AuthService.endDeletedAccountSession).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 500])(
    "n'efface rien quand la suppression échoue (%s)",
    async (status) => {
      deleteMock.mockResolvedValue({
        error: { statusCode: status },
        response: { status },
      });

      await expect(deleteMyAccount("s3cret")).rejects.toThrow();

      expect(AuthService.endDeletedAccountSession).not.toHaveBeenCalled();
    },
  );

  it("n'efface rien quand la requête de suppression lève (réseau)", async () => {
    deleteMock.mockRejectedValue(new Error("Network Error"));

    await expect(deleteMyAccount("s3cret")).rejects.toThrow();

    expect(AuthService.endDeletedAccountSession).not.toHaveBeenCalled();
  });

  it("envoie le mot de passe au backend", async () => {
    deleteMock.mockResolvedValue({ data: { message: "ok" }, response: {} });

    await deleteMyAccount("s3cret");

    expect(deleteMock).toHaveBeenCalledWith({ body: { password: "s3cret" } });
  });

  // #935: a retry after a lost deletion response gets a 401 whose refresh
  // was refused with ACCOUNT_DELETED: not a wrong password.
  it("signale la fin de session quand le 401 a supprimé les jetons", async () => {
    mockGetTokens.mockResolvedValue({});
    deleteMock.mockResolvedValue({
      error: { statusCode: 401 },
      response: { status: 401 },
    });

    await expect(deleteMyAccount("s3cret")).rejects.toThrow("SESSION_ENDED");
    expect(AuthService.endDeletedAccountSession).not.toHaveBeenCalled();
  });

  // #937: a 401 is a session problem now (the wrong password is a 403):
  // the session was refreshed but the deletion did not go through.
  it("ne prend plus un 401 pour un mot de passe incorrect", async () => {
    deleteMock.mockResolvedValue({
      error: { statusCode: 401 },
      response: { status: 401 },
    });

    await expect(deleteMyAccount("s3cret")).rejects.toThrow("DELETE_FAILED");
  });

  it("garde un échec non confirmé si le magasin de jetons est illisible", async () => {
    mockGetTokens.mockRejectedValue(new Error("locked"));
    deleteMock.mockResolvedValue({
      error: { statusCode: 401 },
      response: { status: 401 },
    });

    await expect(deleteMyAccount("s3cret")).rejects.toThrow("DELETE_FAILED");
  });

  it("distingue le mauvais mot de passe (403 WRONG_PASSWORD) des autres erreurs", async () => {
    deleteMock.mockResolvedValue({
      error: { statusCode: 403, code: "WRONG_PASSWORD" },
      response: { status: 403 },
    });
    await expect(deleteMyAccount("bad")).rejects.toThrow("WRONG_PASSWORD");

    // Another 403 (impersonation, store review account): not a wrong password.
    deleteMock.mockResolvedValue({
      error: { statusCode: 403, message: "Interdit" },
      response: { status: 403 },
    });
    await expect(deleteMyAccount("s3cret")).rejects.toThrow("DELETE_FAILED");

    deleteMock.mockResolvedValue({
      error: { statusCode: 500 },
      response: { status: 500 },
    });
    await expect(deleteMyAccount("s3cret")).rejects.toThrow("DELETE_FAILED");
  });
});
