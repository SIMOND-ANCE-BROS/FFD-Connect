import { ConfigService } from "@nestjs/config";
import { ServiceUnavailableException } from "@nestjs/common";
import { BlobServiceClient } from "@azure/storage-blob";
import { Readable } from "stream";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { BlobStorageService } from "./blob-storage.service";

jest.mock("@azure/storage-blob", () => ({
  BlobServiceClient: { fromConnectionString: jest.fn() },
}));
jest.mock("@azure/identity", () => ({ DefaultAzureCredential: jest.fn() }));

describe("BlobStorageService (read helpers)", () => {
  const blockBlob = {
    getProperties: jest.fn(),
    download: jest.fn(),
    deleteIfExists: jest.fn(),
  };
  const containerClient = {
    containerName: "tracks",
    getBlockBlobClient: jest.fn().mockReturnValue(blockBlob),
  };
  const serviceClient = {
    getContainerClient: jest.fn().mockReturnValue(containerClient),
  };

  /** Disjoncteur passant : enregistre la clé puis exécute l'opération. */
  const fire = jest.fn(<T>(_key: string, fn: () => Promise<T>) => fn());
  const circuitBreaker = { fire } as unknown as CircuitBreakerService;

  function makeService(env: Record<string, string | undefined>) {
    const config = {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService;
    return new BlobStorageService(config, circuitBreaker);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    fire.mockImplementation((_key, fn) => fn());
    (BlobServiceClient.fromConnectionString as jest.Mock).mockReturnValue(
      serviceClient,
    );
  });

  it("exposes the default and uploads container names", () => {
    const svc = makeService({ AZURE_STORAGE_CONNECTION_STRING: "x" });
    expect(svc.getDefaultContainer()).toBe("tracks");
    expect(svc.getUploadsContainer()).toBe("uploads");

    const custom = makeService({
      AZURE_STORAGE_CONNECTION_STRING: "x",
      AZURE_STORAGE_CONTAINER: "music",
      AZURE_STORAGE_UPLOADS_CONTAINER: "docs",
    });
    expect(custom.getDefaultContainer()).toBe("music");
    expect(custom.getUploadsContainer()).toBe("docs");
  });

  describe("getProperties", () => {
    it("maps the blob properties from the default container", async () => {
      const lastModified = new Date("2026-09-01T00:00:00Z");
      blockBlob.getProperties.mockResolvedValue({
        contentLength: 42,
        contentType: "audio/mpeg",
        etag: '"e"',
        lastModified,
      });
      const svc = makeService({ AZURE_STORAGE_CONNECTION_STRING: "x" });

      await expect(svc.getProperties("a.mp3")).resolves.toEqual({
        size: 42,
        contentType: "audio/mpeg",
        etag: '"e"',
        lastModified,
      });
      expect(serviceClient.getContainerClient).toHaveBeenCalledWith("tracks");
      expect(containerClient.getBlockBlobClient).toHaveBeenCalledWith("a.mp3");
    });

    it("defaults the size to 0 when the length is missing", async () => {
      blockBlob.getProperties.mockResolvedValue({});
      const svc = makeService({ AZURE_STORAGE_CONNECTION_STRING: "x" });
      await expect(svc.getProperties("a.mp3")).resolves.toEqual(
        expect.objectContaining({ size: 0 }),
      );
    });

    it("returns null when the blob does not exist", async () => {
      blockBlob.getProperties.mockRejectedValue({ statusCode: 404 });
      const svc = makeService({ AZURE_STORAGE_CONNECTION_STRING: "x" });
      await expect(svc.getProperties("missing.mp3")).resolves.toBeNull();
    });

    it.each([new Error("network"), { statusCode: 403 }, null])(
      "propagates other errors (%p)",
      async (err) => {
        blockBlob.getProperties.mockRejectedValue(err);
        const svc = makeService({ AZURE_STORAGE_CONNECTION_STRING: "x" });
        await expect(svc.getProperties("a.mp3")).rejects.toBe(err);
      },
    );

    it("throws when blob storage is not configured", async () => {
      const svc = makeService({});
      expect(svc.isEnabled()).toBe(false);
      await expect(svc.getProperties("a.mp3")).rejects.toThrow(
        "Blob storage not configured",
      );
    });
  });

  describe("downloadRange", () => {
    it("downloads the requested byte range", async () => {
      const body = Readable.from(["x"]);
      blockBlob.download.mockResolvedValue({ readableStreamBody: body });
      const svc = makeService({ AZURE_STORAGE_CONNECTION_STRING: "x" });

      await expect(svc.downloadRange("a.mp3", 10, 5)).resolves.toBe(body);
      expect(blockBlob.download).toHaveBeenCalledWith(10, 5);
    });

    it("throws when the response has no stream", async () => {
      blockBlob.download.mockResolvedValue({});
      const svc = makeService({ AZURE_STORAGE_CONNECTION_STRING: "x" });
      await expect(svc.downloadRange("a.mp3", 0, 1)).rejects.toThrow(
        "has no readable stream",
      );
    });
  });

  // -------------------------------------------------------------------------
  // deleteFile (#79) — primitive d'effacement RGPD : service externe, donc
  // circuit breaker + timeout (CLAUDE.md « External services » / ADR-0009).
  // -------------------------------------------------------------------------

  describe("deleteFile", () => {
    it("deletes the blob from the requested container", async () => {
      blockBlob.deleteIfExists.mockResolvedValue({ succeeded: true });
      const svc = makeService({ AZURE_STORAGE_CONNECTION_STRING: "x" });

      await expect(svc.deleteFile("doc-1.pdf", "uploads")).resolves.toBe(true);
      expect(serviceClient.getContainerClient).toHaveBeenCalledWith("uploads");
      expect(containerClient.getBlockBlobClient).toHaveBeenCalledWith(
        "doc-1.pdf",
      );
      expect(blockBlob.deleteIfExists).toHaveBeenCalledTimes(1);
    });

    it("reports false when the blob was already gone", async () => {
      blockBlob.deleteIfExists.mockResolvedValue({ succeeded: false });
      const svc = makeService({ AZURE_STORAGE_CONNECTION_STRING: "x" });

      await expect(svc.deleteFile("ghost.pdf", "uploads")).resolves.toBe(false);
    });

    it("falls back to the default container", async () => {
      blockBlob.deleteIfExists.mockResolvedValue({ succeeded: true });
      const svc = makeService({ AZURE_STORAGE_CONNECTION_STRING: "x" });

      await svc.deleteFile("a.mp3");
      expect(serviceClient.getContainerClient).toHaveBeenCalledWith("tracks");
    });

    it("runs the Azure call through the azure-blob circuit breaker", async () => {
      blockBlob.deleteIfExists.mockResolvedValue({ succeeded: true });
      const svc = makeService({ AZURE_STORAGE_CONNECTION_STRING: "x" });

      await svc.deleteFile("doc-1.pdf", "uploads");

      expect(fire).toHaveBeenCalledTimes(1);
      expect(fire).toHaveBeenCalledWith("azure-blob", expect.any(Function));
    });

    it("propagates an open circuit without calling Azure", async () => {
      fire.mockRejectedValue(
        new ServiceUnavailableException("azure-blob open"),
      );
      const svc = makeService({ AZURE_STORAGE_CONNECTION_STRING: "x" });

      await expect(svc.deleteFile("doc-1.pdf", "uploads")).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(blockBlob.deleteIfExists).not.toHaveBeenCalled();
    });

    it("rejects instead of hanging when Azure never answers", async () => {
      jest.useFakeTimers();
      try {
        // Azure ne répond jamais : sans `withTimeout`, l'effacement RGPD
        // resterait suspendu sur la requête HTTP de l'utilisateur.
        blockBlob.deleteIfExists.mockReturnValue(new Promise(() => {}));
        const svc = makeService({ AZURE_STORAGE_CONNECTION_STRING: "x" });

        const pending = svc.deleteFile("doc-1.pdf", "uploads");
        const assertion = expect(pending).rejects.toThrow(/timed out/);
        await jest.advanceTimersByTimeAsync(8_000);
        await assertion;
      } finally {
        jest.useRealTimers();
      }
    });

    it("does not open the circuit when storage is simply unconfigured", async () => {
      const svc = makeService({});

      await expect(svc.deleteFile("doc-1.pdf", "uploads")).rejects.toThrow(
        "Blob storage not configured",
      );
      // Une erreur de configuration locale ne doit pas compter comme une
      // panne Azure dans le taux d'échec du disjoncteur.
      expect(fire).not.toHaveBeenCalled();
    });
  });
});
