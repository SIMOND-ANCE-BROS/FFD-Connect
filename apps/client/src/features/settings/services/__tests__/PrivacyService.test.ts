/**
 * Droits RGPD côté client (#424) — export/partage des données + suppression
 * de compte via le client OpenAPI généré.
 */
import { deleteAsync, writeAsStringAsync } from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import {
  usersControllerDeleteMyAccount,
  usersControllerExportMyData,
} from "../../../../api/generated/sdk.gen";
import { runSessionEndCleanups } from "../../../../services/sessionCleanup";
import { AuthService } from "../../../auth/services/AuthService";
import { forgetCguAcceptance } from "../../../legal/cguConsent";
import {
  deleteExportFile,
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
  AuthService: { getAuthConfig: jest.fn() },
}));

jest.mock("../../../legal/cguConsent", () => ({
  forgetCguAcceptance: jest.fn().mockResolvedValue(undefined),
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
    // Purged at the next launch or session end instead.
    expect(deleteFileMock).not.toHaveBeenCalled();
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
  const getAuthConfigMock = AuthService.getAuthConfig as jest.Mock;
  const forgetCguMock = forgetCguAcceptance as jest.Mock;

  beforeEach(() => {
    getAuthConfigMock.mockResolvedValue({ isLoggedIn: true, userId: "u-1" });
  });

  // #930: no account id left on the device once the account is gone.
  it("retire la copie locale de l'acceptation des CGU du compte supprimé", async () => {
    deleteMock.mockResolvedValue({ data: { message: "ok" }, response: {} });

    await deleteMyAccount("s3cret");

    expect(forgetCguMock).toHaveBeenCalledWith("u-1");
  });

  it("garde la copie des CGU si la suppression échoue", async () => {
    deleteMock.mockResolvedValue({
      error: { statusCode: 401 },
      response: { status: 401 },
    });

    await expect(deleteMyAccount("bad")).rejects.toThrow("WRONG_PASSWORD");

    expect(forgetCguMock).not.toHaveBeenCalled();
  });

  it("sans identifiant de compte connu, n'oublie rien", async () => {
    getAuthConfigMock.mockResolvedValue({ isLoggedIn: true });
    deleteMock.mockResolvedValue({ data: { message: "ok" }, response: {} });

    await deleteMyAccount("s3cret");

    expect(forgetCguMock).not.toHaveBeenCalled();
  });

  it("envoie le mot de passe au backend", async () => {
    deleteMock.mockResolvedValue({ data: { message: "ok" }, response: {} });

    await deleteMyAccount("s3cret");

    expect(deleteMock).toHaveBeenCalledWith({ body: { password: "s3cret" } });
  });

  it("distingue le mauvais mot de passe (401) des autres erreurs", async () => {
    deleteMock.mockResolvedValue({
      error: { statusCode: 401 },
      response: { status: 401 },
    });
    await expect(deleteMyAccount("bad")).rejects.toThrow("WRONG_PASSWORD");

    deleteMock.mockResolvedValue({
      error: { statusCode: 500 },
      response: { status: 500 },
    });
    await expect(deleteMyAccount("s3cret")).rejects.toThrow("DELETE_FAILED");
  });
});
