import { INestApplication, ServiceUnavailableException } from "@nestjs/common";
import {
  AbstractLoader,
  ExpressLoader,
  ServeStaticModule,
} from "@nestjs/serve-static";
import { Test } from "@nestjs/testing";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PassThrough, Readable } from "stream";
import request from "supertest";
import { CircuitBreakerService } from "../common/circuit-breaker/circuit-breaker.service";
import { BlobStorageService } from "../storage/blob-storage.service";
import {
  UPLOADS_FALLBACK_PREFIX_EXCLUDE,
  UploadsFallbackController,
} from "./uploads-fallback.controller";

const REAL_TRACK = "04-JIVE ｜ Dj Ice - Blinding Lights (39 MPM)";
const AUDIO = Buffer.from("0123456789abcdefghij"); // 20 bytes
const ETAG = '"0x8DCAFE"';
const LAST_MODIFIED = new Date("2026-09-01T10:00:00Z");

function url(name: string): string {
  return `/uploads/${encodeURIComponent(name)}`;
}

describe("UploadsFallbackController (with ServeStaticModule)", () => {
  let app: INestApplication;
  let tmpRoot: string;
  let blob: {
    isEnabled: jest.Mock;
    getDefaultContainer: jest.Mock;
    getUploadsContainer: jest.Mock;
    getProperties: jest.Mock;
    downloadRange: jest.Mock;
  };
  let breaker: { fire: jest.Mock };

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-fallback-"));
    const uploads = path.join(tmpRoot, "uploads");
    fs.mkdirSync(path.join(uploads, "certificates"), { recursive: true });
    fs.writeFileSync(
      path.join(uploads, "ffd-test-metronome-samba.mp3"),
      Buffer.from("local-disk-audio"),
    );
    fs.writeFileSync(path.join(uploads, "notes.txt"), "plain");
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  async function createApp(): Promise<void> {
    const cwd = jest.spyOn(process, "cwd").mockReturnValue(tmpRoot);
    const moduleRef = await Test.createTestingModule({
      imports: [
        ServeStaticModule.forRoot({
          rootPath: path.join(tmpRoot, "uploads"),
          serveRoot: "/uploads",
        }),
      ],
      controllers: [UploadsFallbackController],
      providers: [
        { provide: BlobStorageService, useValue: blob },
        { provide: CircuitBreakerService, useValue: breaker },
      ],
    })
      // The testing module instantiates providers before the HTTP adapter
      // exists, so ServeStatic would pick its no-op loader; force the Express
      // one to reproduce production (NestFactory.create) routing order.
      .overrideProvider(AbstractLoader)
      .useValue(new ExpressLoader())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix("api/v1", {
      exclude: [UPLOADS_FALLBACK_PREFIX_EXCLUDE],
    });
    await app.init();
    cwd.mockRestore();
  }

  beforeEach(async () => {
    blob = {
      isEnabled: jest.fn().mockReturnValue(true),
      getDefaultContainer: jest.fn().mockReturnValue("tracks"),
      getUploadsContainer: jest.fn().mockReturnValue("uploads"),
      getProperties: jest.fn().mockResolvedValue({
        size: AUDIO.length,
        contentType: "application/octet-stream",
        etag: ETAG,
        lastModified: LAST_MODIFIED,
      }),
      downloadRange: jest.fn(
        (_name: string, offset: number, count: number): Promise<Readable> =>
          Promise.resolve(
            Readable.from([AUDIO.subarray(offset, offset + count)]),
          ),
      ),
    };
    breaker = {
      fire: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
    };
    await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("disk hit (unchanged ServeStatic behaviour)", () => {
    it("serves the local file with Range support and never touches the blob", async () => {
      const res = await request(app.getHttpServer())
        .get("/uploads/ffd-test-metronome-samba.mp3")
        .set("Range", "bytes=0-4");

      expect(res.status).toBe(206);
      expect(res.headers["content-range"]).toBe("bytes 0-4/16");
      expect(res.body.toString()).toBe("local");
      expect(blob.getProperties).not.toHaveBeenCalled();
    });
  });

  describe("disk miss + blob hit", () => {
    it("streams the full blob with media headers", async () => {
      const res = await request(app.getHttpServer())
        .get(url(`${REAL_TRACK}.mp3`))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual(AUDIO);
      expect(res.headers["content-type"]).toBe("audio/mpeg");
      expect(res.headers["content-length"]).toBe(String(AUDIO.length));
      expect(res.headers["accept-ranges"]).toBe("bytes");
      expect(res.headers["etag"]).toBe(ETAG);
      expect(res.headers["last-modified"]).toBe(LAST_MODIFIED.toUTCString());
      expect(res.headers["cache-control"]).toBe("public, max-age=86400");
      expect(res.headers["content-disposition"]).toBeUndefined();
      // Always the default (tracks) container — never an explicit one.
      expect(blob.getProperties).toHaveBeenCalledWith(`${REAL_TRACK}.mp3`);
      expect(blob.downloadRange).toHaveBeenCalledWith(
        `${REAL_TRACK}.mp3`,
        0,
        AUDIO.length,
      );
      expect(breaker.fire).toHaveBeenCalledWith(
        "azure-blob",
        expect.any(Function),
      );
    });

    it("answers a Range request with 206 and Content-Range", async () => {
      const res = await request(app.getHttpServer())
        .get(url(`${REAL_TRACK}.mp3`))
        .set("Range", "bytes=5-9");

      expect(res.status).toBe(206);
      expect(res.headers["content-range"]).toBe(`bytes 5-9/${AUDIO.length}`);
      expect(res.headers["content-length"]).toBe("5");
      expect(res.headers["accept-ranges"]).toBe("bytes");
      expect(res.body.toString()).toBe("56789");
      expect(blob.downloadRange).toHaveBeenCalledWith(
        `${REAL_TRACK}.mp3`,
        5,
        5,
      );
    });

    it("serves artwork with an image content type", async () => {
      const res = await request(app.getHttpServer()).get(
        url(`${REAL_TRACK}.jpg`),
      );
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("image/jpeg");
    });

    it("answers HEAD with headers only, without downloading", async () => {
      const res = await request(app.getHttpServer())
        .head(url(`${REAL_TRACK}.mp3`))
        .set("Range", "bytes=0-1");

      expect(res.status).toBe(206);
      expect(res.headers["content-length"]).toBe("2");
      expect(res.headers["content-range"]).toBe(`bytes 0-1/${AUDIO.length}`);
      expect(blob.downloadRange).not.toHaveBeenCalled();
    });

    it("returns 416 for an unsatisfiable range", async () => {
      const res = await request(app.getHttpServer())
        .get(url(`${REAL_TRACK}.mp3`))
        .set("Range", "bytes=500-");

      expect(res.status).toBe(416);
      expect(res.headers["content-range"]).toBe(`bytes */${AUDIO.length}`);
      expect(blob.downloadRange).not.toHaveBeenCalled();
    });

    it("returns 304 when If-None-Match matches the ETag", async () => {
      const res = await request(app.getHttpServer())
        .get(url(`${REAL_TRACK}.mp3`))
        .set("If-None-Match", ETAG);

      expect(res.status).toBe(304);
      expect(blob.downloadRange).not.toHaveBeenCalled();
    });

    it("ignores Range when If-Range does not match the ETag", async () => {
      const res = await request(app.getHttpServer())
        .get(url(`${REAL_TRACK}.mp3`))
        .set("Range", "bytes=0-1")
        .set("If-Range", '"stale"');

      expect(res.status).toBe(200);
      expect(res.headers["content-length"]).toBe(String(AUDIO.length));
    });

    it("ends an empty blob without downloading", async () => {
      blob.getProperties.mockResolvedValue({ size: 0 });
      const res = await request(app.getHttpServer()).get(url("empty.mp3"));

      expect(res.status).toBe(200);
      expect(res.headers["content-length"]).toBe("0");
      expect(res.headers["etag"]).toBeUndefined();
      expect(blob.downloadRange).not.toHaveBeenCalled();
    });

    it("survives a blob stream that fails mid-transfer", async () => {
      blob.downloadRange.mockImplementation(() => {
        const s = new PassThrough();
        setImmediate(() => {
          s.write("01");
          s.destroy(new Error("socket reset"));
        });
        return Promise.resolve(s);
      });

      await expect(
        request(app.getHttpServer()).get(url(`${REAL_TRACK}.mp3`)),
      ).rejects.toThrow();
      // The app still serves the next request.
      blob.downloadRange.mockResolvedValue(Readable.from([AUDIO]));
      const res = await request(app.getHttpServer()).get(
        url(`${REAL_TRACK}.mp3`),
      );
      expect(res.status).toBe(200);
    });
  });

  describe("hand-over to ServeStatic (today's 404)", () => {
    it("returns the 404 JSON when the blob does not exist either", async () => {
      blob.getProperties.mockResolvedValue(null);
      const res = await request(app.getHttpServer()).get(url("missing.mp3"));

      expect(res.status).toBe(404);
      expect(res.body).toEqual(expect.objectContaining({ statusCode: 404 }));
    });

    it("returns 404 when the blob metadata call fails (graceful degradation)", async () => {
      blob.getProperties.mockRejectedValue(new Error("network down"));
      const res = await request(app.getHttpServer()).get(url("x.mp3"));
      expect(res.status).toBe(404);
    });

    it("returns 404 when the circuit breaker is open", async () => {
      breaker.fire.mockRejectedValue(
        new ServiceUnavailableException("azure-blob open"),
      );
      const res = await request(app.getHttpServer()).get(url("x.mp3"));
      expect(res.status).toBe(404);
    });

    it("returns 404 when the blob download call fails", async () => {
      blob.downloadRange.mockRejectedValue(new Error("403"));
      const res = await request(app.getHttpServer()).get(url("x.mp3"));
      expect(res.status).toBe(404);
    });

    it("leaves non-media names to ServeStatic without a blob lookup", async () => {
      const local = await request(app.getHttpServer()).get(
        "/uploads/notes.txt",
      );
      expect(local.status).toBe(200);
      const missing = await request(app.getHttpServer()).get(
        "/uploads/scan.pdf",
      );
      expect(missing.status).toBe(404);
      expect(blob.getProperties).not.toHaveBeenCalled();
    });

    it.each([
      "/uploads/certificates/scan.jpg",
      "/uploads/renewal/doc.png",
      "/uploads/certificates%2Fscan.jpg",
      "/uploads/..%2F..%2Fetc%2Fpasswd.mp3",
      "/uploads/.hidden.mp3",
    ])("never looks up %s in blob storage", async (p) => {
      const res = await request(app.getHttpServer()).get(p);
      expect(res.status).toBe(404);
      expect(blob.getProperties).not.toHaveBeenCalled();
    });

    it("does nothing when blob storage is disabled", async () => {
      blob.isEnabled.mockReturnValue(false);
      const res = await request(app.getHttpServer()).get(url("x.mp3"));
      expect(res.status).toBe(404);
      expect(blob.getProperties).not.toHaveBeenCalled();
    });

    it("refuses to read when the track container is the documents container", async () => {
      blob.getDefaultContainer.mockReturnValue("uploads");
      const res = await request(app.getHttpServer()).get(url("x.mp3"));
      expect(res.status).toBe(404);
      expect(blob.getProperties).not.toHaveBeenCalled();
    });
  });

  it("is not reachable under the api/v1 prefix", async () => {
    const res = await request(app.getHttpServer()).get(
      `/api/v1${url(`${REAL_TRACK}.mp3`)}`,
    );
    expect(res.status).toBe(404);
    expect(blob.getProperties).not.toHaveBeenCalled();
  });
});
