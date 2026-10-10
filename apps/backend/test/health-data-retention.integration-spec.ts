/**
 * Health data retention purge (#62) against a real Postgres (issue #141).
 *
 * The unit suite asserts the purge against a mocked Prisma; the defects that
 * mattered (a candidate batch sliced in memory, a hand-written migration never
 * replayed) were only visible on real rows. Here every query runs for real:
 * the type filter, the `purgeDueAt <= now` bound, the dating of legacy rows,
 * the `ocrData` wipe, the `deleteMany`, and the #224 scrub migration.
 *
 * Only the blob client is faked: `BlobStorageService.isEnabled` and
 * `deleteFile` are spied on the real instance, so the real
 * `RenewalDocumentFileCleaner`, circuit breaker and timeout sit in between.
 */
import { promises as fsp } from "fs";
import * as path from "path";
import { LicenseRenewalDocumentType, Prisma } from "@prisma/client";
import { TestingModule } from "@nestjs/testing";
import { HealthDataRetentionService } from "../src/licenses/health-data-retention.service";
import { LicenseRenewalService } from "../src/licenses/license-renewal.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { BlobStorageService } from "../src/storage/blob-storage.service";
import { OcrService } from "../src/utils/ocr.service";
import { createFactories } from "./factories";
import { buildServiceModule } from "./integration-app.builder";

const { MEDICAL_CERTIFICATE, LICENSE_CERTIFICATE } = LicenseRenewalDocumentType;

const PAST = new Date("2000-01-01T00:00:00Z");
const FUTURE = new Date("2100-01-01T00:00:00Z");

const MEDICAL_KEYS = ["date", "doctorName", "isApte"];
const LICENSE_KEYS = ["expiryDate", "licenseNumber"];

const SCRUB_MIGRATION = path.resolve(
  __dirname,
  "../prisma/schema/migrations/20261010120000_scrub_renewal_ocr_raw_text/migration.sql",
);

describe("Health data retention purge (integration, real DB)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let retention: HealthDataRetentionService;
  let blob: BlobStorageService;
  let f: ReturnType<typeof createFactories>;
  let requestId: string;
  let userId: string;

  /** Blob names whose delete must fail, as a throttled storage would. */
  const failingBlobs = new Set<string>();
  let deleteFile: jest.SpyInstance;
  let isEnabled: jest.SpyInstance;

  beforeAll(async () => {
    // The boot pass would race the fixtures: each test drives the purge itself.
    jest
      .spyOn(HealthDataRetentionService.prototype, "onModuleInit")
      .mockImplementation(() => undefined);
    const built = await buildServiceModule();
    moduleRef = built.module;
    prisma = built.prisma;
    retention = moduleRef.get(HealthDataRetentionService);
    blob = moduleRef.get(BlobStorageService);
    f = createFactories(prisma, `retention-${Date.now()}`);
    userId = (await f.user()).user.id;
    requestId = (
      await prisma.licenseRenewalRequest.create({
        data: { userId },
        select: { id: true },
      })
    ).id;
  });

  beforeEach(async () => {
    // The purge is global by design: rows left by another suite would change
    // the reports asserted below.
    await prisma.licenseRenewalDocument.deleteMany({});
    failingBlobs.clear();
    jest.restoreAllMocks();
    isEnabled = jest.spyOn(blob, "isEnabled").mockReturnValue(true);
    deleteFile = jest
      .spyOn(blob, "deleteFile")
      .mockImplementation(async (blobName: string) => {
        if (failingBlobs.has(blobName)) throw new Error("throttled");
        return true;
      });
  });

  afterAll(async () => {
    await prisma.licenseRenewalDocument.deleteMany({});
    await f.cleanup();
    await moduleRef.close();
  });

  const doc = (data: {
    filePath: string;
    type?: LicenseRenewalDocumentType;
    purgeDueAt?: Date | null;
    createdAt?: Date;
    ocrData?: Prisma.InputJsonValue;
  }) =>
    prisma.licenseRenewalDocument.create({
      data: { requestId, type: MEDICAL_CERTIFICATE, ...data },
      select: { id: true },
    });

  const find = (id: string) =>
    prisma.licenseRenewalDocument.findUnique({
      where: { id },
      select: { ocrData: true, purgeDueAt: true },
    });

  it("purges a due medical certificate (file then row) and keeps one not yet due", async () => {
    const due = await doc({
      filePath: "due.pdf",
      purgeDueAt: PAST,
      ocrData: { isApte: true, date: "1998-01-01" },
    });
    const notDue = await doc({
      filePath: "not-due.pdf",
      purgeDueAt: FUTURE,
      ocrData: { isApte: true, date: "2099-01-01" },
    });

    const report = await retention.purgeExpiredHealthData();

    expect(report).toEqual({
      dated: 0,
      due: 1,
      stripped: 1,
      purged: 1,
      retryLater: 0,
      skipped: false,
    });
    expect(await find(due.id)).toBeNull();
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith("due.pdf", "uploads");
    expect(await find(notDue.id)).toEqual({
      ocrData: { isApte: true, date: "2099-01-01" },
      purgeDueAt: FUTURE,
    });
  });

  it("treats purgeDueAt == now as due (lte bound)", async () => {
    const now = new Date();
    const atBound = await doc({ filePath: "bound.pdf", purgeDueAt: now });

    const report = await retention.purgeExpiredHealthData();

    expect(report.purged).toBe(1);
    expect(await find(atBound.id)).toBeNull();
  });

  it("never purges a licence certificate, even with a past due date", async () => {
    const licence = await doc({
      filePath: "licence.pdf",
      type: LICENSE_CERTIFICATE,
      purgeDueAt: PAST,
      ocrData: { licenseNumber: "123456" },
    });

    const report = await retention.purgeExpiredHealthData();

    expect(report.due).toBe(0);
    expect(deleteFile).not.toHaveBeenCalled();
    expect(await find(licence.id)).toEqual({
      ocrData: { licenseNumber: "123456" },
      purgeDueAt: PAST,
    });
  });

  it("dates legacy rows (purgeDueAt IS NULL), then purges those already due", async () => {
    // Dated certificate, issued 1999-06-01 → due 2001-06-01 (12 + 12 months).
    const oldDated = await doc({
      filePath: "legacy-old.pdf",
      purgeDueAt: null,
      createdAt: new Date("1999-07-01T00:00:00Z"),
      ocrData: { isApte: true, date: "1999-06-01T00:00:00.000Z" },
    });
    // Undated certificate uploaded now → due in 12 months: dated, kept.
    const recent = await doc({
      filePath: "legacy-recent.pdf",
      purgeDueAt: null,
    });
    // A legacy licence certificate stays undated: not health data.
    const licence = await doc({
      filePath: "legacy-licence.pdf",
      type: LICENSE_CERTIFICATE,
      purgeDueAt: null,
    });

    const report = await retention.purgeExpiredHealthData();

    expect(report).toMatchObject({ dated: 2, due: 1, purged: 1 });
    expect(await find(oldDated.id)).toBeNull();
    const kept = await find(recent.id);
    expect(kept?.purgeDueAt).not.toBeNull();
    const monthsAhead =
      ((kept?.purgeDueAt?.getTime() ?? 0) - Date.now()) /
      (1000 * 60 * 60 * 24 * 30.44);
    expect(monthsAhead).toBeGreaterThan(11.5);
    expect(monthsAhead).toBeLessThan(12.5);
    expect((await find(licence.id))?.purgeDueAt).toBeNull();
  });

  it("wipes ocrData but keeps the row when the file resists, and retries it on the next pass", async () => {
    const resisting = await doc({
      filePath: "resisting.pdf",
      purgeDueAt: PAST,
      ocrData: { isApte: true, date: "1998-01-01", doctorName: "Dr X" },
    });
    failingBlobs.add("resisting.pdf");

    const first = await retention.purgeExpiredHealthData();

    expect(first).toMatchObject({
      due: 1,
      stripped: 1,
      purged: 0,
      retryLater: 1,
    });
    // `Prisma.DbNull` → SQL NULL, not a JSON `null`.
    expect(await find(resisting.id)).toEqual({
      ocrData: null,
      purgeDueAt: PAST,
    });
    const [{ sqlNull }] = await prisma.$queryRaw<{ sqlNull: boolean }[]>`
      SELECT "ocrData" IS NULL AS "sqlNull"
      FROM "LicenseRenewalDocument" WHERE id = ${resisting.id}`;
    expect(sqlNull).toBe(true);

    failingBlobs.clear();
    const second = await retention.purgeExpiredHealthData();

    expect(second).toMatchObject({ due: 1, purged: 1, retryLater: 0 });
    expect(await find(resisting.id)).toBeNull();
  });

  it("deletes a legacy local-disk reference under uploads/ without touching blob storage", async () => {
    const dir = path.resolve(process.cwd(), "uploads", "renewal");
    await fsp.mkdir(dir, { recursive: true });
    const name = `retention-${Date.now()}.pdf`;
    await fsp.writeFile(path.join(dir, name), "certificate");
    const legacy = await doc({
      filePath: `uploads/renewal/${name}`,
      purgeDueAt: PAST,
    });

    const report = await retention.purgeExpiredHealthData();

    expect(report.purged).toBe(1);
    expect(deleteFile).not.toHaveBeenCalled();
    expect(await find(legacy.id)).toBeNull();
    await expect(fsp.access(path.join(dir, name))).rejects.toThrow();
  });

  it("is skipped entirely when blob storage is not configured — nothing is dated, wiped or deleted", async () => {
    // Without storage the purge cannot prove a file is gone: deleting the row
    // would orphan the certificate in the container. The pass is a no-op that
    // reports `skipped`, and the next pass with storage back does the work.
    isEnabled.mockReturnValue(false);
    const due = await doc({
      filePath: "due.pdf",
      purgeDueAt: PAST,
      ocrData: { isApte: true },
    });
    const legacy = await doc({ filePath: "legacy.pdf", purgeDueAt: null });

    const report = await retention.purgeExpiredHealthData();

    expect(report).toEqual({
      dated: 0,
      due: 0,
      stripped: 0,
      purged: 0,
      retryLater: 0,
      skipped: true,
    });
    expect(deleteFile).not.toHaveBeenCalled();
    expect(await find(due.id)).toEqual({
      ocrData: { isApte: true },
      purgeDueAt: PAST,
    });
    expect((await find(legacy.id))?.purgeDueAt).toBeNull();
  });

  it("is idempotent: a second pass finds nothing and deletes nothing", async () => {
    await doc({ filePath: "a.pdf", purgeDueAt: PAST });
    await doc({ filePath: "b.pdf", purgeDueAt: null, createdAt: PAST });
    await doc({ filePath: "c.pdf", purgeDueAt: FUTURE });

    const first = await retention.purgeExpiredHealthData();
    expect(first).toMatchObject({ dated: 1, due: 2, purged: 2 });
    deleteFile.mockClear();

    const second = await retention.purgeExpiredHealthData();

    expect(second).toEqual({
      dated: 0,
      due: 0,
      stripped: 0,
      purged: 0,
      retryLater: 0,
      skipped: false,
    });
    expect(deleteFile).not.toHaveBeenCalled();
    expect(await prisma.licenseRenewalDocument.count()).toBe(1);
  });

  it("purges a due document hidden behind older documents that are not due (non-monotonic deadline)", async () => {
    // The first implementation sorted by upload date and sliced in memory:
    // 30 old-but-valid certificates filled the batch and the due one was
    // never reached. The stored `purgeDueAt` filter must reach it.
    await prisma.licenseRenewalDocument.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        requestId,
        type: MEDICAL_CERTIFICATE,
        filePath: `old-valid-${i}.pdf`,
        createdAt: PAST,
        purgeDueAt: FUTURE,
      })),
    });
    const due = await doc({ filePath: "recent-due.pdf", purgeDueAt: PAST });

    const report = await retention.purgeExpiredHealthData();

    expect(report).toMatchObject({ due: 1, purged: 1 });
    expect(await find(due.id)).toBeNull();
  });

  describe("ocrData whitelist (#224 / #237)", () => {
    it("stores only whitelisted keys on upload, and the purge deadline from the issue date", async () => {
      const renewal = moduleRef.get(LicenseRenewalService);
      const ocr = moduleRef.get(OcrService);
      jest.spyOn(blob, "uploadBuffer").mockResolvedValue("ignored");
      const issued = new Date();
      issued.setUTCDate(issued.getUTCDate() - 10);
      const medicalOcr = {
        isApte: true,
        date: issued.toISOString(),
        doctorName: "Dr X",
        rawText: "CERTIFICAT MEDICAL — texte de santé",
      };
      jest
        .spyOn(ocr, "extractMedicalCertificateInfo")
        .mockResolvedValue(medicalOcr);
      const licenceOcr = {
        licenseNumber: "123456",
        expiryDate: "2099-08-31",
        name: "Jean Dupont",
        rawText: "LICENCE",
      };
      jest.spyOn(ocr, "extractLicenseInfo").mockResolvedValue(licenceOcr);

      await renewal.uploadRenewalDocument(
        userId,
        requestId,
        MEDICAL_CERTIFICATE,
        Buffer.from("medical"),
        "medical-blob",
      );
      await renewal.uploadRenewalDocument(
        userId,
        requestId,
        LICENSE_CERTIFICATE,
        Buffer.from("licence"),
        "licence-blob",
      );

      const rows = await prisma.licenseRenewalDocument.findMany({
        where: { requestId },
        select: { type: true, ocrData: true, purgeDueAt: true },
        take: 10,
      });
      const medical = rows.find((r) => r.type === MEDICAL_CERTIFICATE);
      const licence = rows.find((r) => r.type === LICENSE_CERTIFICATE);
      expect(Object.keys(medical?.ocrData ?? {}).sort()).toEqual(MEDICAL_KEYS);
      expect(Object.keys(licence?.ocrData ?? {}).sort()).toEqual(LICENSE_KEYS);
      // Issue date + 12 months of validity + 12 months of retention.
      const expected = new Date(issued);
      expected.setUTCFullYear(expected.getUTCFullYear() + 2);
      expect(medical?.purgeDueAt?.toISOString().slice(0, 10)).toBe(
        expected.toISOString().slice(0, 10),
      );
      expect(licence?.purgeDueAt).toBeNull();
    });

    it("the scrub migration reduces legacy rows to the whitelist, leaves non-objects alone, and is idempotent", async () => {
      const medical = await doc({
        filePath: "legacy-medical.pdf",
        purgeDueAt: FUTURE,
        ocrData: {
          isApte: true,
          date: "2026-01-01",
          doctorName: "Dr X",
          rawText: "texte de santé",
        },
      });
      const licence = await doc({
        filePath: "legacy-licence.pdf",
        type: LICENSE_CERTIFICATE,
        ocrData: { licenseNumber: "1", name: "Jean Dupont", rawText: "x" },
      });
      const notAnObject = await doc({
        filePath: "legacy-array.pdf",
        purgeDueAt: FUTURE,
        ocrData: ["rawText"],
      });
      const sql = await fsp.readFile(SCRUB_MIGRATION, "utf8");

      const firstRun = await prisma.$executeRawUnsafe(sql);
      const secondRun = await prisma.$executeRawUnsafe(sql);

      expect(firstRun).toBe(2);
      expect(secondRun).toBe(0);
      expect((await find(medical.id))?.ocrData).toEqual({
        isApte: true,
        date: "2026-01-01",
        doctorName: "Dr X",
      });
      expect((await find(licence.id))?.ocrData).toEqual({
        licenseNumber: "1",
      });
      expect((await find(notAnObject.id))?.ocrData).toEqual(["rawText"]);

      // After the migration, no renewal document in the base carries a key
      // outside its type's whitelist.
      const offending = await prisma.$queryRaw<{ id: string }[]>`
        SELECT d.id FROM "LicenseRenewalDocument" d,
          jsonb_object_keys(d."ocrData") AS k
        WHERE jsonb_typeof(d."ocrData") = 'object'
          AND k <> ALL (CASE WHEN d."type" = 'MEDICAL_CERTIFICATE'
            THEN ARRAY['isApte', 'date', 'doctorName']
            ELSE ARRAY['licenseNumber', 'expiryDate'] END)`;
      expect(offending).toEqual([]);
    });
  });
});
