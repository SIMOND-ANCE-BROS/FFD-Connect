import { ConfigService } from "@nestjs/config";
import { BlobServiceClient } from "@azure/storage-blob";
import { Readable } from "stream";
import { BlobStorageService } from "./blob-storage.service";

jest.mock("@azure/storage-blob", () => ({
  BlobServiceClient: { fromConnectionString: jest.fn() },
}));
jest.mock("@azure/identity", () => ({ DefaultAzureCredential: jest.fn() }));

describe("BlobStorageService (read helpers)", () => {
  const blockBlob = {
    getProperties: jest.fn(),
    download: jest.fn(),
  };
  const containerClient = {
    containerName: "tracks",
    getBlockBlobClient: jest.fn().mockReturnValue(blockBlob),
  };
  const serviceClient = {
    getContainerClient: jest.fn().mockReturnValue(containerClient),
  };

  function makeService(env: Record<string, string | undefined>) {
    const config = {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService;
    return new BlobStorageService(config);
  }

  beforeEach(() => {
    jest.clearAllMocks();
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
});
