import { crc32, deflateRawSync } from "zlib";
import { buildZip } from "./__fixtures__/zip-builder";
import {
  SafeZipError,
  SafeZipLimits,
  readSafeZip,
  safeEntryPath,
} from "./safe-zip";

const LIMITS: SafeZipLimits = {
  maxEntries: 10,
  maxFileBytes: 1000,
  maxTotalBytes: 1500,
  maxRatio: 100,
};

function refusal(buffer: Buffer, limits: SafeZipLimits = LIMITS): string {
  try {
    readSafeZip(buffer, limits);
  } catch (error) {
    expect(error).toBeInstanceOf(SafeZipError);
    return (error as Error).message;
  }
  throw new Error("archive accepted");
}

describe("safeEntryPath", () => {
  it.each([
    ["index.htm", "index.htm"],
    ["./a/erg.htm", "a/erg.htm"],
    ["a\\b\\erg.htm", "a/b/erg.htm"],
    ["a//b/", "a/b"],
  ])("normalises %s", (name, expected) => {
    expect(safeEntryPath(name)).toBe(expected);
  });

  it.each([
    "/etc/passwd",
    "../evil.htm",
    "a/../../evil.htm",
    "a\\..\\evil.htm",
    "C:/Windows/evil.htm",
    "c:evil",
    "a\u0000b",
    "a\nb",
  ])("refuses %j", (name) => {
    expect(safeEntryPath(name)).toBeNull();
  });
});

describe("readSafeZip", () => {
  it("reads deflated and stored files, skipping directories", () => {
    const zip = buildZip([
      { name: "export/", content: "" },
      { name: "export/index.htm", content: "<html>é</html>" },
      { name: "export/a/erg.htm", content: "stored", method: 0 },
    ]);
    const files = readSafeZip(zip, LIMITS);
    expect([...files.keys()]).toEqual(["export/index.htm", "export/a/erg.htm"]);
    expect(files.get("export/index.htm")?.toString("utf8")).toBe(
      "<html>é</html>",
    );
    expect(files.get("export/a/erg.htm")?.toString("utf8")).toBe("stored");
  });

  it("only extracts the kept files, without checking the others' size", () => {
    const zip = buildZip([
      { name: "index.htm", content: "ok" },
      { name: "big.jpg", content: Buffer.alloc(5000, 1) },
    ]);
    const files = readSafeZip(zip, {
      ...LIMITS,
      keep: (path) => path.endsWith(".htm"),
    });
    expect([...files.keys()]).toEqual(["index.htm"]);
  });

  it("refuses a path traversal, even in a skipped file", () => {
    const zip = buildZip([{ name: "../evil.jpg", content: "x" }]);
    expect(refusal(zip, { ...LIMITS, keep: () => false })).toMatch(
      /Chemin interdit/,
    );
  });

  it("refuses an absolute path", () => {
    expect(refusal(buildZip([{ name: "/tmp/x.htm", content: "x" }]))).toMatch(
      /Chemin interdit/,
    );
  });

  it("refuses a symbolic link", () => {
    const zip = buildZip([
      { name: "erg.htm", content: "/etc/passwd", unixMode: 0o120777 },
    ]);
    expect(refusal(zip)).toMatch(/Lien symbolique/);
  });

  it("refuses a special file (fifo)", () => {
    const zip = buildZip([{ name: "f", content: "", unixMode: 0o010644 }]);
    expect(refusal(zip)).toMatch(/Fichier spécial/);
  });

  it("accepts a regular unix file and a unix directory entry", () => {
    const zip = buildZip([
      { name: "d", content: "", unixMode: 0o040755 },
      { name: "d/erg.htm", content: "x", unixMode: 0o100644 },
    ]);
    expect([...readSafeZip(zip, LIMITS).keys()]).toEqual(["d/erg.htm"]);
  });

  it("refuses an encrypted entry", () => {
    expect(refusal(buildZip([{ name: "a", content: "x", flags: 1 }]))).toMatch(
      /chiffrée/,
    );
  });

  it("refuses an unknown compression method", () => {
    expect(
      refusal(buildZip([{ name: "a", content: "x", method: 12 }])),
    ).toMatch(/Méthode de compression/);
  });

  it("refuses too many entries", () => {
    const entries = Array.from({ length: 11 }, (_, i) => ({
      name: `f${i}.htm`,
      content: "x",
    }));
    expect(refusal(buildZip(entries))).toMatch(/11 fichiers, maximum 10/);
  });

  it("refuses a file bigger than the limit", () => {
    const zip = buildZip([{ name: "a", content: Buffer.alloc(1001, 65) }]);
    expect(refusal(zip, { ...LIMITS, maxRatio: 1e9 })).toMatch(
      /Fichier trop volumineux/,
    );
  });

  it("refuses an archive bigger than the total limit", () => {
    const zip = buildZip([
      { name: "a", content: Buffer.alloc(800, 65), method: 0 },
      { name: "b", content: Buffer.alloc(800, 66), method: 0 },
    ]);
    expect(refusal(zip)).toMatch(/une fois décompressée/);
  });

  it("refuses a suspicious compression ratio", () => {
    const zip = buildZip([{ name: "a", content: Buffer.alloc(1000, 0) }]);
    expect(refusal(zip, { ...LIMITS, maxRatio: 20 })).toMatch(
      /Taux de compression/,
    );
  });

  it("stops a zip bomb lying about its size", () => {
    const real = Buffer.alloc(100_000, 0);
    const zip = buildZip([
      {
        name: "bomb.htm",
        content: real,
        declaredSize: 10,
        crc: crc32(real),
      },
    ]);
    expect(refusal(zip, { ...LIMITS, maxRatio: 1e9 })).toMatch(
      /illisible|corrompue/,
    );
  });

  it("refuses a corrupted entry (CRC mismatch)", () => {
    const zip = buildZip([{ name: "a", content: "hello", crc: 1234 }]);
    expect(refusal(zip)).toMatch(/corrompue/);
  });

  it("refuses a stored entry whose sizes differ", () => {
    const zip = buildZip([
      { name: "a", content: "hello", method: 0, declaredSize: 4 },
    ]);
    expect(refusal(zip)).toMatch(/illisible/);
  });

  it("refuses a duplicate path", () => {
    const zip = buildZip([
      { name: "a/erg.htm", content: "1" },
      { name: "a\\erg.htm", content: "2" },
    ]);
    expect(refusal(zip)).toMatch(/en double/);
  });

  it("refuses what is not a zip", () => {
    expect(refusal(Buffer.from("not a zip at all, sorry"))).toMatch(
      /illisible/,
    );
    expect(refusal(Buffer.alloc(5))).toMatch(/illisible/);
  });

  it("refuses an invalid deflate stream", () => {
    const zip = buildZip([{ name: "a", content: "hello" }]);
    // Corrupt the compressed data (right after the 30-byte header + name).
    const broken = Buffer.from(zip);
    broken.fill(0xff, 31, 36);
    expect(refusal(broken)).toMatch(/illisible|corrompue/);
  });

  it("refuses a truncated archive (central directory out of bounds)", () => {
    const zip = buildZip([{ name: "a", content: "hello" }]);
    const eocd = zip.length - 22;
    const broken = Buffer.from(zip);
    broken.writeUInt32LE(eocd + 100, eocd + 16);
    expect(refusal(broken)).toMatch(/illisible/);
  });

  it("refuses a multi-disk and a zip64 archive", () => {
    const zip = buildZip([{ name: "a", content: "x" }]);
    const eocd = zip.length - 22;
    const multi = Buffer.from(zip);
    multi.writeUInt16LE(1, eocd + 4);
    expect(refusal(multi)).toMatch(/plusieurs parties/);
    const zip64 = Buffer.from(zip);
    zip64.writeUInt32LE(0xffffffff, eocd + 16);
    expect(refusal(zip64)).toMatch(/zip64/);
  });

  it("refuses an entry whose local header is missing", () => {
    const zip = buildZip([{ name: "a", content: "x" }]);
    const broken = Buffer.from(zip);
    broken.writeUInt32LE(0, 0);
    expect(refusal(broken)).toMatch(/illisible/);
  });

  it("refuses data running past the end of the archive", () => {
    const data = deflateRawSync(Buffer.from("hello"));
    const zip = buildZip([{ name: "a", content: "hello" }]);
    const broken = Buffer.from(zip);
    const cd = zip.length - 22 - 46 - 1;
    broken.writeUInt32LE(data.length + 10_000, cd + 20);
    expect(refusal(broken, { ...LIMITS, maxRatio: 1e9 })).toMatch(/illisible/);
  });
});
