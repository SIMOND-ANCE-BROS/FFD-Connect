import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { promises as fsp } from "fs";
import * as os from "os";
import * as path from "path";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { BlobStorageService } from "../storage/blob-storage.service";
import {
  TRACK_FILE_UPLOAD_TIMEOUT_MS,
  TRACK_STORAGE_UNAVAILABLE_MESSAGE,
  TrackFilesService,
} from "./track-files.service";

describe("TrackFilesService", () => {
  let blob: {
    isEnabled: jest.Mock;
    uploadBuffer: jest.Mock;
    deleteFile: jest.Mock;
  };
  let breaker: { fire: jest.Mock };
  let cwd: string;

  // Built after the cwd spy: the service resolves uploads/ on construction.
  const build = () =>
    new TrackFilesService(
      blob as unknown as BlobStorageService,
      breaker as unknown as CircuitBreakerService,
    );

  beforeEach(async () => {
    blob = {
      isEnabled: jest.fn().mockReturnValue(true),
      uploadBuffer: jest.fn().mockResolvedValue("https://blob/tracks/x"),
      deleteFile: jest.fn().mockResolvedValue(true),
    };
    breaker = {
      fire: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
    };
    cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "track-files-"));
    jest.spyOn(process, "cwd").mockReturnValue(cwd);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fsp.rm(cwd, { recursive: true, force: true });
  });

  it("uploads to the tracks container behind the blob write breaker", async () => {
    const buffer = Buffer.from("ID3");
    await build().save("3f2c.mp3", buffer);
    expect(breaker.fire).toHaveBeenCalledWith(
      "azure-blob-write",
      expect.any(Function),
    );
    expect(blob.uploadBuffer).toHaveBeenCalledWith(buffer, "3f2c.mp3");
  });

  it("writes to uploads/ on disk when blob storage is disabled", async () => {
    blob.isEnabled.mockReturnValue(false);
    await build().save("3f2c.png", Buffer.from("png"));
    await expect(
      fsp.readFile(path.join(cwd, "uploads", "3f2c.png"), "utf8"),
    ).resolves.toBe("png");
    expect(blob.uploadBuffer).not.toHaveBeenCalled();
  });

  it.each(["../x.mp3", "a/b.mp3", ".hidden.mp3", "x.exe"])(
    "refuses the name %s",
    async (name) => {
      await expect(build().save(name, Buffer.from("x"))).rejects.toThrow(
        "Refused track file name",
      );
      expect(blob.uploadBuffer).not.toHaveBeenCalled();
    },
  );

  it("propagates an upload failure (the caller rolls back)", async () => {
    blob.uploadBuffer.mockRejectedValue(new Error("blob down"));
    await expect(build().save("a.mp3", Buffer.from("x"))).rejects.toThrow(
      "blob down",
    );
  });

  it("deletes each blob behind the blob breaker and never throws", async () => {
    blob.deleteFile
      .mockRejectedValueOnce(new Error("blob down"))
      .mockResolvedValueOnce(true);
    await expect(build().remove(["a.mp3", "b.jpg"])).resolves.toBeUndefined();
    expect(breaker.fire).toHaveBeenCalledWith(
      "azure-blob",
      expect.any(Function),
    );
    expect(blob.deleteFile).toHaveBeenCalledWith("a.mp3");
    expect(blob.deleteFile).toHaveBeenCalledWith("b.jpg");
  });

  it("deletes from uploads/ on disk when blob storage is disabled, flattening the name", async () => {
    blob.isEnabled.mockReturnValue(false);
    await fsp.mkdir(path.join(cwd, "uploads"));
    await fsp.writeFile(path.join(cwd, "uploads", "old.mp3"), "x");
    await build().remove(["../uploads/old.mp3"]);
    await expect(
      fsp.stat(path.join(cwd, "uploads", "old.mp3")),
    ).rejects.toThrow();
  });

  it("does nothing for an empty list", async () => {
    await build().remove([]);
    expect(breaker.fire).not.toHaveBeenCalled();
  });

  it("times out a hanging upload through the real withTimeout", async () => {
    jest.useFakeTimers();
    try {
      blob.uploadBuffer.mockReturnValue(new Promise(() => undefined));
      const saving = build().save("a.mp3", Buffer.from("x"));
      // A storage timeout is a 503 (runbook « Disponibilité du stockage »).
      const assertion = expect(saving).rejects.toThrow(
        new ServiceUnavailableException(TRACK_STORAGE_UNAVAILABLE_MESSAGE),
      );
      await jest.advanceTimersByTimeAsync(TRACK_FILE_UPLOAD_TIMEOUT_MS);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it("turns a breaker-open error on save into a French 503", async () => {
    breaker.fire.mockRejectedValue(new ServiceUnavailableException());
    await expect(build().save("a.mp3", Buffer.from("x"))).rejects.toThrow(
      new ServiceUnavailableException(TRACK_STORAGE_UNAVAILABLE_MESSAGE),
    );
    expect(blob.uploadBuffer).not.toHaveBeenCalled();
  });

  it("turns the breaker's own timeout on save into a 503", async () => {
    breaker.fire.mockRejectedValue(
      Object.assign(new Error("Timed out after 45000ms"), {
        code: "ETIMEDOUT",
      }),
    );
    await expect(
      build().save("a.mp3", Buffer.from("x")),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("swallows a breaker-open error on remove and logs the orphan name", async () => {
    breaker.fire.mockRejectedValue(new ServiceUnavailableException());
    const warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    await expect(build().remove(["orphan.mp3"])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("orphan.mp3"));
  });
});
