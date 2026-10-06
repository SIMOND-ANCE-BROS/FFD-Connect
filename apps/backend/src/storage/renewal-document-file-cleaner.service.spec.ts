import { Logger } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import * as Sentry from "@sentry/nestjs";
import * as fs from "fs";
import * as path from "path";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { BlobStorageService } from "./blob-storage.service";
import {
  RENEWAL_BLOB_DELETE_TIMEOUT_MS,
  RenewalDocumentFileCleaner,
} from "./renewal-document-file-cleaner.service";

jest.mock("@sentry/nestjs", () => ({ captureMessage: jest.fn() }));

describe("RenewalDocumentFileCleaner", () => {
  let cleaner: RenewalDocumentFileCleaner;
  let blobStorage: {
    isEnabled: jest.Mock;
    deleteFile: jest.Mock;
    getUploadsContainer: jest.Mock;
  };
  let circuitBreaker: { fire: jest.Mock };
  let errorLog: jest.SpyInstance;
  const captureMessage = Sentry.captureMessage as jest.Mock;

  beforeEach(async () => {
    blobStorage = {
      isEnabled: jest.fn().mockReturnValue(true),
      deleteFile: jest.fn().mockResolvedValue(true),
      getUploadsContainer: jest.fn().mockReturnValue("uploads"),
    };
    circuitBreaker = {
      fire: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
    };
    errorLog = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RenewalDocumentFileCleaner,
        { provide: BlobStorageService, useValue: blobStorage },
        { provide: CircuitBreakerService, useValue: circuitBreaker },
      ],
    }).compile();
    cleaner = module.get(RenewalDocumentFileCleaner);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    captureMessage.mockReset();
  });

  it("aucune référence : aucun appel au stockage", async () => {
    await cleaner.deleteFiles([], "account-deletion");

    expect(circuitBreaker.fire).not.toHaveBeenCalled();
    expect(blobStorage.deleteFile).not.toHaveBeenCalled();
  });

  it("supprime chaque blob du conteneur uploads via le circuit breaker azure-blob", async () => {
    await cleaner.deleteFiles(
      ["document-1.jpg", "document-2.pdf"],
      "account-deletion",
    );

    expect(blobStorage.deleteFile).toHaveBeenCalledWith(
      "document-1.jpg",
      "uploads",
    );
    expect(blobStorage.deleteFile).toHaveBeenCalledWith(
      "document-2.pdf",
      "uploads",
    );
    expect(circuitBreaker.fire).toHaveBeenCalledTimes(2);
    expect(circuitBreaker.fire).toHaveBeenCalledWith(
      "azure-blob",
      expect.any(Function),
    );
    expect(errorLog).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("lance les suppressions en parallèle (pas d'attente séquentielle)", async () => {
    const pending: Array<(value: boolean) => void> = [];
    blobStorage.deleteFile.mockImplementation(
      () => new Promise<boolean>((resolve) => pending.push(resolve)),
    );

    const done = cleaner.deleteFiles(
      ["document-1.jpg", "document-2.jpg", "document-3.jpg"],
      "account-deletion",
    );
    // Laisse les microtâches s'exécuter : les trois appels doivent être
    // démarrés avant qu'aucun ne soit résolu.
    await Promise.resolve();
    await Promise.resolve();
    expect(blobStorage.deleteFile).toHaveBeenCalledTimes(3);

    pending.forEach((resolve) => resolve(true));
    await expect(done).resolves.toEqual(
      new Set(["document-1.jpg", "document-2.jpg", "document-3.jpg"]),
    );
  });

  it("applique un timeout sur l'appel blob", async () => {
    jest.useFakeTimers();
    try {
      blobStorage.deleteFile.mockReturnValue(new Promise<boolean>(() => {}));

      const done = cleaner.deleteFiles(["document-1.jpg"], "account-deletion");
      await jest.advanceTimersByTimeAsync(RENEWAL_BLOB_DELETE_TIMEOUT_MS + 1);
      await done;

      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(String(errorLog.mock.calls[0][0])).toContain("[Timeout]");
    } finally {
      jest.useRealTimers();
    }
  });

  it("échec : ne lève pas, error log + Sentry avec la seule référence du fichier ; les autres sont tentés", async () => {
    blobStorage.deleteFile
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(true);

    // Seul le fichier réellement parti est rapporté : la purge de rétention
    // (#62) s'en sert pour ne PAS effacer la ligne qui pointe encore vers un
    // blob survivant, et le retenter au passage suivant.
    await expect(
      cleaner.deleteFiles(
        ["document-1.jpg", "document-2.jpg"],
        "document-replaced",
      ),
    ).resolves.toEqual(new Set(["document-2.jpg"]));

    expect(blobStorage.deleteFile).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledTimes(1);
    const message = String(errorLog.mock.calls[0][0]);
    expect(message).toContain("document-1.jpg");
    expect(message).toContain("network down");
    expect(message).toContain("document-replaced");

    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith(
      "Renewal document file deletion failed",
      {
        level: "error",
        tags: {
          rgpd: "file-deletion-failed",
          cleanup_context: "document-replaced",
        },
        extra: { fileReference: "document-1.jpg", error: "network down" },
      },
    );
  });

  it("circuit breaker ouvert : ne lève pas, échec remonté", async () => {
    circuitBreaker.fire.mockRejectedValue(new Error("breaker open"));

    await expect(
      cleaner.deleteFiles(["document-1.jpg"], "upload-rollback"),
    ).resolves.toEqual(new Set());

    expect(captureMessage).toHaveBeenCalledWith(
      "Renewal document file deletion failed",
      expect.objectContaining({
        tags: {
          rgpd: "file-deletion-failed",
          cleanup_context: "upload-rollback",
        },
      }),
    );
  });

  it("blob déjà absent (deleteIfExists → false) : succès silencieux", async () => {
    blobStorage.deleteFile.mockResolvedValue(false);

    await cleaner.deleteFiles(["document-1.jpg"], "account-deletion");

    expect(errorLog).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("stockage blob non configuré : rien n'a été persisté, aucun appel", async () => {
    blobStorage.isEnabled.mockReturnValue(false);

    await cleaner.deleteFiles(["document-1.jpg"], "account-deletion");

    expect(circuitBreaker.fire).not.toHaveBeenCalled();
    expect(blobStorage.deleteFile).not.toHaveBeenCalled();
  });

  it("référence historique (chemin disque) : suppression locale confinée à uploads/", async () => {
    const rm = jest.spyOn(fs.promises, "rm").mockResolvedValue(undefined);

    await cleaner.deleteFiles(
      ["uploads/renewal/document-1.jpg"],
      "account-deletion",
    );

    expect(rm).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "uploads/renewal/document-1.jpg"),
      { force: true },
    );
    expect(blobStorage.deleteFile).not.toHaveBeenCalled();
  });

  it("référence historique hors uploads/ : rien n'est supprimé, échec remonté", async () => {
    const rm = jest.spyOn(fs.promises, "rm").mockResolvedValue(undefined);

    await expect(
      cleaner.deleteFiles(["../etc/passwd"], "account-deletion"),
    ).resolves.toEqual(new Set());

    expect(rm).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  it("le préfixe uploads sans séparateur (uploads-evil/…) n'est pas accepté", async () => {
    const rm = jest.spyOn(fs.promises, "rm").mockResolvedValue(undefined);

    await cleaner.deleteFiles(["uploads-evil/x.jpg"], "account-deletion");

    expect(rm).not.toHaveBeenCalled();
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });
});
