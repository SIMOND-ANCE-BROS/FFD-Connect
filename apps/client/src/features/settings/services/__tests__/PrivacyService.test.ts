/**
 * Droits RGPD côté client (#424) — export/partage des données + suppression
 * de compte via le client OpenAPI généré.
 */
import { writeAsStringAsync } from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import {
  usersControllerDeleteMyAccount,
  usersControllerExportMyData,
} from "../../../../api/generated/sdk.gen";
import { deleteMyAccount, exportAndShareMyData } from "../PrivacyService";

jest.mock("../../../../api/generated/sdk.gen", () => ({
  usersControllerExportMyData: jest.fn(),
  usersControllerDeleteMyAccount: jest.fn(),
}));

jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  shareAsync: jest.fn().mockResolvedValue(undefined),
}));

const exportMock = usersControllerExportMyData as jest.Mock;
const deleteMock = usersControllerDeleteMyAccount as jest.Mock;
const writeMock = writeAsStringAsync as jest.Mock;
const shareMock = Sharing.shareAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
});

describe("exportAndShareMyData", () => {
  it("écrit le JSON dans le cache puis ouvre la feuille de partage", async () => {
    const payload = { format: "ffd-connect-export-v1", data: { id: "u1" } };
    exportMock.mockResolvedValue({ data: payload });

    await exportAndShareMyData();

    const [uri, contents] = writeMock.mock.calls[0];
    expect(uri).toBe("file:///cache/ffd-connect-mes-donnees.json");
    expect(JSON.parse(contents)).toEqual(payload);
    expect(shareMock).toHaveBeenCalledWith(
      uri,
      expect.objectContaining({ mimeType: "application/json" }),
    );
  });

  it("échoue sans rien écrire si l'API renvoie une erreur", async () => {
    exportMock.mockResolvedValue({ error: { statusCode: 500 } });

    await expect(exportAndShareMyData()).rejects.toThrow("EXPORT_FAILED");
    expect(writeMock).not.toHaveBeenCalled();
    expect(shareMock).not.toHaveBeenCalled();
  });

  it("échoue si le partage n'est pas disponible sur l'appareil", async () => {
    exportMock.mockResolvedValue({ data: { ok: true } });
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);

    await expect(exportAndShareMyData()).rejects.toThrow("SHARING_UNAVAILABLE");
    expect(shareMock).not.toHaveBeenCalled();
  });
});

describe("deleteMyAccount", () => {
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
