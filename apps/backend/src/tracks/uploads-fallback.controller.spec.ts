import { INestApplication, ServiceUnavailableException } from "@nestjs/common";
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
// Content of every on-disk file that must stay unreachable.
const SECRET = "SECRET-DOCUMENT-CONTENT";

function url(name: string): string {
  return `/uploads/${encodeURIComponent(name)}`;
}

function binaryParser(
  r: NodeJS.ReadableStream,
  cb: (err: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  r.on("data", (c: Buffer) => chunks.push(c));
  r.on("end", () => cb(null, Buffer.concat(chunks)));
}

describe("UploadsFallbackController (sole owner of /uploads)", () => {
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
    // Sensitive files that must never be reachable, even though they exist.
    for (const dir of ["certificates", "renewal", "tts_cache", "nested"]) {
      fs.mkdirSync(path.join(uploads, dir), { recursive: true });
    }
    fs.writeFileSync(path.join(uploads, "certificates", "scan.jpg"), SECRET);
    fs.writeFileSync(path.join(uploads, "certificates", "scan.pdf"), SECRET);
    fs.writeFileSync(path.join(uploads, "renewal", "doc.png"), SECRET);
    fs.writeFileSync(path.join(uploads, "tts_cache", "abc.mp3"), SECRET);
    fs.writeFileSync(path.join(uploads, "nested", "track.mp3"), SECRET);
    fs.writeFileSync(path.join(tmpRoot, "outside.mp3"), SECRET);
    fs.writeFileSync(path.join(uploads, ".hidden.mp3"), SECRET);
    fs.writeFileSync(path.join(uploads, "notes.txt"), SECRET);
    fs.writeFileSync(path.join(uploads, "scan.pdf"), SECRET);
    // Flat track media, legitimately served.
    fs.writeFileSync(
      path.join(uploads, "ffd-test-metronome-samba.mp3"),
      Buffer.from("local-disk-audio"),
    );
    fs.writeFileSync(path.join(uploads, "cover é.png"), Buffer.from("png!"));
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  async function createApp(): Promise<void> {
    const cwd = jest.spyOn(process, "cwd").mockReturnValue(tmpRoot);
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadsFallbackController],
      providers: [
        { provide: BlobStorageService, useValue: blob },
        { provide: CircuitBreakerService, useValue: breaker },
      ],
    }).compile();
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

  describe("disk hit", () => {
    it("serves the local file with Range support and never touches the blob", async () => {
      const res = await request(app.getHttpServer())
        .get("/uploads/ffd-test-metronome-samba.mp3")
        .set("Range", "bytes=0-4");

      expect(res.status).toBe(206);
      expect(res.headers["content-range"]).toBe("bytes 0-4/16");
      expect(res.headers["content-length"]).toBe("5");
      expect(res.headers["accept-ranges"]).toBe("bytes");
      expect(res.headers["content-type"]).toBe("audio/mpeg");
      expect(res.body.toString()).toBe("local");
      expect(blob.getProperties).not.toHaveBeenCalled();
    });

    it("serves the full local mp3 with caching headers", async () => {
      const res = await request(app.getHttpServer())
        .get("/uploads/ffd-test-metronome-samba.mp3")
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.body.toString()).toBe("local-disk-audio");
      expect(res.headers["content-type"]).toBe("audio/mpeg");
      expect(res.headers["cache-control"]).toBe("public, max-age=86400");
      expect(res.headers["etag"]).toBeDefined();
      expect(res.headers["last-modified"]).toBeDefined();
    });

    it("answers a conditional request with 304", async () => {
      const first = await request(app.getHttpServer()).get(
        "/uploads/ffd-test-metronome-samba.mp3",
      );
      const res = await request(app.getHttpServer())
        .get("/uploads/ffd-test-metronome-samba.mp3")
        .set("If-None-Match", String(first.headers["etag"]));
      expect(res.status).toBe(304);
    });

    it("answers an unsatisfiable Range on a local file with an uncached 416", async () => {
      const res = await request(app.getHttpServer())
        .get("/uploads/ffd-test-metronome-samba.mp3")
        .set("Range", "bytes=999999999-");

      expect(res.status).toBe(416);
      expect(res.headers["content-range"]).toBe("bytes */16");
      expect(res.headers["cache-control"] ?? "").not.toMatch(/max-age/);
      expect(res.headers["etag"]).toBeUndefined();
      expect(res.headers["last-modified"]).toBeUndefined();
      expect(res.headers["content-type"]).toBeUndefined();
      expect(blob.getProperties).not.toHaveBeenCalled();
    });

    it("strips the file headers when send fails otherwise (412 → 404)", async () => {
      const ok = await request(app.getHttpServer()).get(
        "/uploads/ffd-test-metronome-samba.mp3",
      );
      const res = await request(app.getHttpServer())
        .get("/uploads/ffd-test-metronome-samba.mp3")
        .set("If-Match", '"not-the-etag"');

      expect(res.status).toBe(404);
      expect(res.headers["cache-control"] ?? "").not.toMatch(/max-age/);
      // Only Express's own weak ETag of the JSON body, never the file's.
      expect(res.headers["etag"]).not.toBe(ok.headers["etag"]);
      expect(res.headers["last-modified"]).toBeUndefined();
      expect(res.headers["content-range"]).toBeUndefined();
      expect(res.headers["accept-ranges"]).toBeUndefined();
      expect(res.headers["content-type"]).toMatch(/application\/json/);
    });

    it("answers HEAD on a local file without a body", async () => {
      const res = await request(app.getHttpServer()).head(
        "/uploads/ffd-test-metronome-samba.mp3",
      );
      expect(res.status).toBe(200);
      expect(res.headers["content-length"]).toBe("16");
      expect(blob.getProperties).not.toHaveBeenCalled();
    });

    it("serves local artwork (non-ASCII name) as an image", async () => {
      const res = await request(app.getHttpServer())
        .get(url("cover é.png"))
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("image/png");
      expect(res.body.toString()).toBe("png!");
    });

    it("serves local files even when blob storage is disabled", async () => {
      blob.isEnabled.mockReturnValue(false);
      const res = await request(app.getHttpServer()).get(
        "/uploads/ffd-test-metronome-samba.mp3",
      );
      expect(res.status).toBe(200);
    });
  });

  describe("only flat track media are reachable (#293)", () => {
    it.each([
      "/uploads/certificates/scan.jpg",
      "/uploads/certificates/scan.pdf",
      "/uploads/renewal/doc.png",
      "/uploads/tts_cache/abc.mp3",
      "/uploads/nested/track.mp3",
      "/uploads/certificates%2Fscan.jpg",
      "/uploads/renewal%2Fdoc.png",
      "/uploads/tts_cache%2Fabc.mp3",
      "/uploads/..%2Foutside.mp3",
      "/uploads/../outside.mp3",
      "/uploads/%2E%2E%2Foutside.mp3",
      "/uploads/nested/..%2F..%2Foutside.mp3",
      "/uploads/.hidden.mp3",
      "/uploads/notes.txt",
      "/uploads/scan.pdf",
      "/uploads/",
      "/uploads",
    ])("returns 404 for %s although the file exists on disk", async (p) => {
      for (const enabled of [true, false]) {
        blob.isEnabled.mockReturnValue(enabled);
        const res = await request(app.getHttpServer()).get(p);
        expect(res.status).toBe(404);
        expect(res.text).not.toContain(SECRET);
      }
      expect(blob.getProperties).not.toHaveBeenCalled();
    });

    it("returns 404 on HEAD for a document sub-folder", async () => {
      const res = await request(app.getHttpServer()).head(
        "/uploads/certificates/scan.jpg",
      );
      expect(res.status).toBe(404);
    });
  });

  describe("disk miss + blob hit", () => {
    it("streams the full blob with media headers", async () => {
      const res = await request(app.getHttpServer())
        .get(url(`${REAL_TRACK}.mp3`))
        .buffer(true)
        .parse(binaryParser);

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

  describe("404 cases", () => {
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

    it.each([
      "/uploads/certificates/scan.jpg",
      "/uploads/renewal/doc.png",
      "/uploads/certificates%2Fscan.jpg",
      "/uploads/..%2F..%2Fetc%2Fpasswd.mp3",
      "/uploads/.hidden.mp3",
      "/uploads/missing.pdf",
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
