import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { join } from "path";
import { AdminAuditService } from "../../admin/admin-audit.service";
import { PrismaService } from "../../prisma/prisma.service";
import { DELETED_USER_ID } from "../../users/account-deletion.core";
import { erasedLicenceFingerprint } from "../../utils/results-pseudonym";
import { parseResultsCsv } from "../results-import/results-csv.parser";
import { CompetitionCacheService } from "./competition-cache.service";
import { CompetitionEventNotificationService } from "./competition-event-notification.service";
import {
  CompetitionResultsImportService,
  UNLINKED_RESULT_USER_ID,
  normalizeResultText,
  resultImportKey,
} from "./competition-results-import.service";

const FIXTURE = readFileSync(
  join(__dirname, "../../../test/fixtures/results-import/finale-latines.csv"),
  "utf8",
);

// A fake key (not a secret): only its length matters.
const KEY = "k".repeat(40);
const HEADER = "epreuve;tour;classement;couple;dossard;licences";

function rowOf(csv: string, index = 0) {
  return parseResultsCsv(csv).rows[index];
}

describe("CompetitionResultsImportService (#652)", () => {
  let service: CompetitionResultsImportService;
  let prisma: DeepMockProxy<PrismaClient>;
  let config: Record<string, string | undefined>;
  let cache: { invalidateResults: jest.Mock };
  let notifications: { notifyResultsPublished: jest.Mock };
  let audit: { recordOp: jest.Mock };

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    prisma.competition.findUnique.mockResolvedValue({ id: "comp-1" } as never);
    prisma.event.findMany.mockResolvedValue([{ id: "ev-latin" }] as never);
    prisma.license.findMany.mockResolvedValue([]);
    prisma.retiredLicenseNumber.findMany.mockResolvedValue([]);
    prisma.erasedResultIdentity.findMany.mockResolvedValue([]);
    prisma.registration.findMany.mockResolvedValue([]);
    prisma.result.findMany.mockResolvedValue([]);
    prisma.result.createMany.mockReturnValue("create-op" as never);
    prisma.result.updateMany.mockImplementation(
      (args) => ({ update: args }) as never,
    );
    prisma.$transaction.mockResolvedValue([] as never);
    config = { RESULTS_PSEUDONYMISATION_KEY: KEY, NODE_ENV: "production" };
    cache = { invalidateResults: jest.fn().mockResolvedValue(undefined) };
    notifications = {
      notifyResultsPublished: jest.fn().mockResolvedValue(undefined),
    };
    audit = { recordOp: jest.fn().mockReturnValue("audit-op") };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitionResultsImportService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: (name: string) => config[name] },
        },
        { provide: AdminAuditService, useValue: audit },
        { provide: CompetitionCacheService, useValue: cache },
        {
          provide: CompetitionEventNotificationService,
          useValue: notifications,
        },
      ],
    }).compile();
    service = module.get(CompetitionResultsImportService);
  });

  const createdRows = () =>
    prisma.result.createMany.mock.calls[0][0]?.data as {
      userId: string;
      partnerUserId: string | null;
      importKey: string;
      details: Record<string, unknown>;
      ranking: number;
      round: string;
    }[];

  /** Existing rows found by key (first findMany), tombstones (second). */
  const existingRows = (
    existing: Record<string, unknown>[],
    tombstones: Record<string, unknown>[] = [],
  ) =>
    prisma.result.findMany.mockImplementation(((args: {
      where: { userId?: string };
    }) =>
      Promise.resolve(
        args.where.userId === DELETED_USER_ID ? tombstones : existing,
      )) as never);

  const existing = (csv: string, fields: Record<string, unknown>) => ({
    id: "r1",
    eventId: "ev-latin",
    round: "Finale",
    importKey: resultImportKey(KEY, rowOf(csv)),
    userId: UNLINKED_RESULT_USER_ID,
    partnerUserId: null,
    ranking: 1,
    details: { participant: "Alpha / Bravo", bib: "12" },
    ...fields,
  });

  describe("resultImportKey (L4, M2)", () => {
    it("is a keyed HMAC: never the name, never a plain SHA-256, key-dependent", () => {
      const row = rowOf(`${HEADER}\nev;Finale;1;Alpha / Bravo;;\n`);
      const key = resultImportKey(KEY, row);

      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).not.toContain("alpha");
      expect(key).not.toBe(
        createHash("sha256")
          .update("v1|ev|Finale|label:alpha / bravo")
          .digest("hex"),
      );
      expect(resultImportKey(`${KEY}-other`, row)).not.toBe(key);
    });

    it("keys on the bib when there is one, so a corrected label is the same couple", () => {
      const a = rowOf(`${HEADER}\nev;Finale;1;Alpha / Bravo;12;\n`);
      const b = rowOf(`${HEADER}\nev;Finale;2;Alpha / Bravoo;12;\n`);
      expect(resultImportKey(KEY, a)).toBe(resultImportKey(KEY, b));
    });

    it("normalises the label and the round (case, accents, spaces)", () => {
      const a = rowOf(`${HEADER}\nev;1/2  Finale;1;Élodie  / Bravo;;\n`);
      const b = rowOf(`${HEADER}\nev;1/2 finale;1;elodie / bravo;;\n`);
      expect(resultImportKey(KEY, a)).toBe(resultImportKey(KEY, b));
      expect(normalizeResultText("  1/2   FINALE ")).toBe("1/2 finale");
    });

    it("differs per event and per round", () => {
      const base = rowOf(`${HEADER}\nev;Finale;1;A / B;12;\n`);
      const otherRound = rowOf(`${HEADER}\nev;1/2 finale;1;A / B;12;\n`);
      const otherEvent = rowOf(`${HEADER}\nev2;Finale;1;A / B;12;\n`);
      expect(resultImportKey(KEY, base)).not.toBe(
        resultImportKey(KEY, otherRound),
      );
      expect(resultImportKey(KEY, base)).not.toBe(
        resultImportKey(KEY, otherEvent),
      );
    });
  });

  it("503 in production without a pseudonymisation key, before any read", async () => {
    config = { NODE_ENV: "production", RESULTS_PSEUDONYMISATION_KEY: "short" };
    await expect(
      service.importCsv("comp-1", FIXTURE, "staff-1"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.competition.findUnique).not.toHaveBeenCalled();
  });

  it("uses the development key outside production", async () => {
    config = { NODE_ENV: "development" };
    await expect(
      service.importCsv("comp-1", FIXTURE, "staff-1"),
    ).resolves.toMatchObject({ created: 4 });
  });

  it("404 when the competition does not exist", async () => {
    prisma.competition.findUnique.mockResolvedValue(null);
    await expect(
      service.importCsv("nope", FIXTURE, "staff-1"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("imports the fixture: one row per couple, both members linked by licence (M1), bib fallback for a line without licence", async () => {
    prisma.license.findMany.mockResolvedValue([
      { number: "100001", userId: "user-alpha" },
      { number: "100002", userId: "user-bravo" },
    ] as never);
    prisma.registration.findMany.mockResolvedValue([
      {
        eventId: "ev-latin",
        bibNumber: 31,
        userId: "user-echo",
        partnerUserId: "user-foxtrot",
      },
    ] as never);

    const report = await service.importCsv("comp-1", FIXTURE, "staff-1");

    expect(report).toEqual({
      created: 4,
      updated: 0,
      unchanged: 0,
      relinked: 0,
      anonymisedKept: 0,
      linked: 2,
      unlinked: 2,
    });
    expect(prisma.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["ev-latin"] }, competitionId: "comp-1" },
      }),
    );
    expect(prisma.license.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          number: { in: ["100001", "100002", "100003", "100004"] },
          userId: { not: null },
        },
      }),
    );
    // L2: only the lines WITHOUT licence numbers fall back to the bib.
    expect(prisma.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { not: "CANCELLED" },
          OR: [
            { eventId: "ev-latin", bibNumber: 31 },
            { eventId: "ev-latin", bibNumber: 44 },
          ],
        },
      }),
    );
    const rows = createdRows();
    expect(rows.map((r) => [r.userId, r.partnerUserId])).toEqual([
      ["user-alpha", "user-bravo"],
      [UNLINKED_RESULT_USER_ID, null],
      ["user-echo", "user-foxtrot"],
      [UNLINKED_RESULT_USER_ID, null],
    ]);
    expect(rows[0]).toMatchObject({
      round: "Finale",
      ranking: 1,
      details: {
        participant: "Alpha / Bravo",
        bib: "12",
        club: "Club Fictif A",
        totalParticipants: 6,
      },
    });
    // Licence numbers are matching input only: never stored.
    expect(JSON.stringify(rows)).not.toContain("100001");
    expect(rows[3].details.status).toBe("ELIMINATED");
    expect(prisma.result.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(["create-op", "audit-op"]);
    expect(cache.invalidateResults).toHaveBeenCalledWith("comp-1");
    expect(notifications.notifyResultsPublished).toHaveBeenCalledWith("comp-1");
  });

  it("writes an audit row with the author and the counts only (L5)", async () => {
    const report = await service.importCsv("comp-1", FIXTURE, "staff-1");

    expect(audit.recordOp).toHaveBeenCalledWith({
      actorId: "staff-1",
      action: "COMPETITION_RESULTS_IMPORT",
      targetType: "COMPETITION",
      targetId: "comp-1",
      after: report,
    });
    expect(JSON.stringify(audit.recordOp.mock.calls)).not.toContain("Alpha");
  });

  it("never links through a retired licence number (M3)", async () => {
    prisma.license.findMany.mockResolvedValue([
      { number: "100001", userId: "new-holder" },
    ] as never);
    prisma.retiredLicenseNumber.findMany.mockResolvedValue([
      { number: "100001" },
    ] as never);
    const csv = `${HEADER}\nev-latin;Finale;1;A / B;12;100001\n`;

    const report = await service.importCsv("comp-1", csv, "staff-1");

    expect(prisma.retiredLicenseNumber.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { number: { in: ["100001"] } } }),
    );
    expect(report).toMatchObject({ linked: 0, unlinked: 1 });
    expect(createdRows()[0].userId).toBe(UNLINKED_RESULT_USER_ID);
    // L2: the row carries a licence, so the bib is not tried either.
    expect(prisma.registration.findMany).not.toHaveBeenCalled();
  });

  it("does not link by bib when more than two accounts hold it, nor for a non-numeric bib", async () => {
    prisma.registration.findMany.mockResolvedValue([
      {
        eventId: "ev-latin",
        bibNumber: 12,
        userId: "u-a",
        partnerUserId: "u-b",
      },
      {
        eventId: "ev-latin",
        bibNumber: 12,
        userId: "u-c",
        partnerUserId: null,
      },
    ] as never);
    const csv = `${HEADER}\nev-latin;Finale;1;A / B;12;\nev-latin;Finale;2;C / D;A7;\n`;

    const report = await service.importCsv("comp-1", csv, "staff-1");

    expect(report.linked).toBe(0);
    expect(createdRows().map((r) => r.userId)).toEqual([
      UNLINKED_RESULT_USER_ID,
      UNLINKED_RESULT_USER_ID,
    ]);
    expect(
      (
        prisma.registration.findMany.mock.calls[0][0] as {
          where: { OR: unknown[] };
        }
      ).where.OR,
    ).toEqual([{ eventId: "ev-latin", bibNumber: 12 }]);
  });

  it("skips the licence and registration lookups when nothing can match", async () => {
    await service.importCsv(
      "comp-1",
      "epreuve;tour;classement;couple\nev-latin;Finale;1;A / B\n",
      "staff-1",
    );
    expect(prisma.license.findMany).not.toHaveBeenCalled();
    expect(prisma.retiredLicenseNumber.findMany).not.toHaveBeenCalled();
    expect(prisma.erasedResultIdentity.findMany).not.toHaveBeenCalled();
    expect(prisma.registration.findMany).not.toHaveBeenCalled();
  });

  it("re-running the same file changes nothing (idempotent) but still asks for the notification", async () => {
    const csv = `${HEADER}\nev-latin;Finale;1;Alpha / Bravo;12;\n`;
    // jsonb does not keep key order.
    existingRows([
      existing(csv, { details: { bib: "12", participant: "Alpha / Bravo" } }),
    ]);

    const report = await service.importCsv("comp-1", csv, "staff-1");

    expect(report).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(prisma.$transaction).toHaveBeenCalledWith(["audit-op"]);
    expect(cache.invalidateResults).not.toHaveBeenCalled();
    expect(notifications.notifyResultsPublished).toHaveBeenCalledWith("comp-1");
  });

  it("updates a corrected line in place, guarded on its owner, and counts the new link as relinked (L3)", async () => {
    const csv = `${HEADER}\nev-latin;Finale;2;Alpha / Bravo;12;100001|100002\n`;
    existingRows([existing(csv, {})]);
    prisma.license.findMany.mockResolvedValue([
      { number: "100001", userId: "user-alpha" },
      { number: "100002", userId: "user-bravo" },
    ] as never);

    const report = await service.importCsv("comp-1", csv, "staff-1");

    expect(report).toMatchObject({
      created: 0,
      updated: 1,
      relinked: 1,
      linked: 1,
    });
    expect(prisma.result.updateMany).toHaveBeenCalledWith({
      where: { id: "r1", userId: UNLINKED_RESULT_USER_ID },
      data: {
        ranking: 2,
        userId: "user-alpha",
        partnerUserId: "user-bravo",
        details: { participant: "Alpha / Bravo", bib: "12" },
      },
    });
    expect(prisma.result.createMany).not.toHaveBeenCalled();
  });

  it("a ranking-only correction is not a relink", async () => {
    const csv = `${HEADER}\nev-latin;Finale;3;Alpha / Bravo;12;\n`;
    existingRows([
      existing(csv, { userId: "user-alpha", partnerUserId: "user-bravo" }),
    ]);

    const report = await service.importCsv("comp-1", csv, "staff-1");

    expect(report).toMatchObject({ updated: 1, relinked: 0, linked: 1 });
    expect(prisma.result.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-alpha",
          partnerUserId: "user-bravo",
          ranking: 3,
        }),
      }),
    );
  });

  it("never rewrites a row anonymised by an account deletion (RGPD, #382)", async () => {
    const csv = `${HEADER}\nev-latin;Finale;1;Alpha / Bravo;12;100001\n`;
    existingRows([existing(csv, { userId: DELETED_USER_ID, details: {} })]);
    prisma.license.findMany.mockResolvedValue([
      { number: "100001", userId: "user-new" },
    ] as never);

    const report = await service.importCsv("comp-1", csv, "staff-1");

    expect(report).toEqual({
      created: 0,
      updated: 0,
      unchanged: 0,
      relinked: 0,
      anonymisedKept: 1,
      linked: 0,
      unlinked: 0,
    });
    expect(prisma.result.updateMany).not.toHaveBeenCalled();
    expect(prisma.result.createMany).not.toHaveBeenCalled();
  });

  it("does not recreate a couple whose row was anonymised under another key: same event, round (normalised) and rank (M2)", async () => {
    // Label changed and no bib: the key differs, the tombstone does not.
    existingRows(
      [],
      [{ eventId: "ev-latin", round: "1/2 FINALE", ranking: 4 }],
    );
    const csv = `${HEADER}\nev-latin;1/2 finale;4;Alpha / Bravo (corrigé);;\nev-latin;1/2 finale;5;Charlie / Delta;;\n`;

    const report = await service.importCsv("comp-1", csv, "staff-1");

    expect(prisma.result.findMany).toHaveBeenCalledWith({
      where: { eventId: { in: ["ev-latin"] }, userId: DELETED_USER_ID },
      select: { eventId: true, round: true, ranking: true },
      take: 2000,
    });
    expect(report).toMatchObject({ created: 1, anonymisedKept: 1 });
    expect(createdRows().map((r) => r.details.participant)).toEqual([
      "Charlie / Delta",
    ]);
  });

  it("writes anonymised a line carrying a deleted account's licence, keeping the surviving member (M2)", async () => {
    prisma.erasedResultIdentity.findMany.mockResolvedValue([
      { fingerprint: erasedLicenceFingerprint(KEY, "100001") },
    ] as never);
    prisma.license.findMany.mockResolvedValue([
      { number: "100002", userId: "user-bravo" },
    ] as never);
    const csv = `${HEADER}\nev-latin;Finale;1;Alpha / Bravo;12;100001|100002\n`;

    const report = await service.importCsv("comp-1", csv, "staff-1");

    // Fingerprints only are looked up, never the numbers.
    expect(prisma.erasedResultIdentity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          fingerprint: {
            in: [
              erasedLicenceFingerprint(KEY, "100001"),
              erasedLicenceFingerprint(KEY, "100002"),
            ],
          },
        },
      }),
    );
    expect(report).toMatchObject({ created: 1, anonymisedKept: 1, linked: 0 });
    expect(createdRows()[0]).toMatchObject({
      userId: DELETED_USER_ID,
      partnerUserId: "user-bravo",
      details: {},
    });
  });

  it("anonymises an existing row once its licence is erased", async () => {
    prisma.erasedResultIdentity.findMany.mockResolvedValue([
      { fingerprint: erasedLicenceFingerprint(KEY, "100001") },
    ] as never);
    const csv = `${HEADER}\nev-latin;Finale;1;Alpha / Bravo;12;100001\n`;
    existingRows([
      existing(csv, {
        details: {
          participant: "Alpha / Bravo",
          bib: "12",
          totalParticipants: 6,
        },
      }),
    ]);

    await service.importCsv("comp-1", csv, "staff-1");

    expect(prisma.result.updateMany).toHaveBeenCalledWith({
      where: { id: "r1", userId: UNLINKED_RESULT_USER_ID },
      data: {
        ranking: 1,
        userId: DELETED_USER_ID,
        partnerUserId: null,
        details: {},
      },
    });
  });

  it("keeps a row already scrubbed for the erased partner with its surviving holder, instead of anonymising it", async () => {
    prisma.erasedResultIdentity.findMany.mockResolvedValue([
      { fingerprint: erasedLicenceFingerprint(KEY, "100002") },
    ] as never);
    prisma.license.findMany.mockResolvedValue([
      { number: "100001", userId: "user-alpha" },
    ] as never);
    const csv = `${HEADER}\nev-latin;Finale;1;Alpha / Bravo;12;100001|100002\n`;
    existingRows([
      existing(csv, {
        userId: "user-alpha",
        details: { participant: "Alpha / Partenaire supprimé" },
      }),
    ]);

    const report = await service.importCsv("comp-1", csv, "staff-1");

    expect(report).toMatchObject({
      unchanged: 1,
      anonymisedKept: 0,
      linked: 1,
    });
    expect(prisma.result.updateMany).not.toHaveBeenCalled();
  });

  it("no longer applies the erasure to a licence held again by a living account", async () => {
    prisma.erasedResultIdentity.findMany.mockResolvedValue([
      { fingerprint: erasedLicenceFingerprint(KEY, "100001") },
    ] as never);
    prisma.license.findMany.mockResolvedValue([
      { number: "100001", userId: "came-back" },
    ] as never);
    const csv = `${HEADER}\nev-latin;Finale;1;Alpha / Bravo;12;100001\n`;

    await service.importCsv("comp-1", csv, "staff-1");

    expect(createdRows()[0]).toMatchObject({
      userId: "came-back",
      details: { participant: "Alpha / Bravo" },
    });
  });

  it("keeps an existing account link when the new file has no match", async () => {
    const csv = `${HEADER}\nev-latin;Finale;3;Alpha / Bravo;12;\n`;
    existingRows([existing(csv, { userId: "user-alpha" })]);

    const report = await service.importCsv("comp-1", csv, "staff-1");

    expect(report.linked).toBe(1);
    expect(prisma.result.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "user-alpha", ranking: 3 }),
      }),
    );
  });

  it("keeps a label scrubbed for a deleted partner (#395) while updating the ranking", async () => {
    const csv = `${HEADER}\nev-latin;Finale;2;Alpha / Bravo;12;\n`;
    existingRows([
      existing(csv, {
        userId: "user-alpha",
        details: { participant: "Alpha / Partenaire supprimé" },
      }),
    ]);

    await service.importCsv("comp-1", csv, "staff-1");

    expect(prisma.result.updateMany).toHaveBeenCalledWith({
      where: { id: "r1", userId: "user-alpha" },
      data: {
        ranking: 2,
        userId: "user-alpha",
        partnerUserId: null,
        details: { participant: "Alpha / Partenaire supprimé" },
      },
    });
  });

  it("treats a non-object stored details as changed", async () => {
    const csv = `${HEADER}\nev-latin;Finale;1;Alpha / Bravo;12;\n`;
    existingRows([existing(csv, { details: null })]);

    const report = await service.importCsv("comp-1", csv, "staff-1");
    expect(report.updated).toBe(1);
  });

  describe("all or nothing", () => {
    const rejected = async (csv: string) => {
      const error: unknown = await service
        .importCsv("comp-1", csv, "staff-1")
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(notifications.notifyResultsPublished).not.toHaveBeenCalled();
      return (error as BadRequestException).getResponse() as {
        message: string;
        errors: { line: number; message: string }[];
      };
    };

    it("rejects the file when a line is invalid", async () => {
      const body = await rejected(
        `${HEADER}\nev-latin;Finale;1;A / B;;\nev-latin;Finale;x;C / D;;\n`,
      );
      expect(body.message).toContain("rien n'a été importé");
      expect(body.errors).toEqual([
        { line: 3, message: "classement invalide (entier ≥ 1 attendu)" },
      ]);
      expect(prisma.event.findMany).not.toHaveBeenCalled();
    });

    it("rejects an event of another competition", async () => {
      const body = await rejected(
        `${HEADER}\nev-latin;Finale;1;A / B;;\nev-other;Finale;1;C / D;;\n`,
      );
      expect(body.errors).toEqual([
        { line: 3, message: "épreuve inconnue pour cette compétition" },
      ]);
    });

    it("rejects the same couple twice in an event and round, rounds compared normalised", async () => {
      const body = await rejected(
        `${HEADER}\nev-latin;Finale;1;A / B;12;\nev-latin;FINALE;2;A / B bis;12;\n`,
      );
      expect(body.errors).toEqual([
        {
          line: 3,
          message: "même couple que la ligne 2 pour cette épreuve et ce tour",
        },
      ]);
    });
  });
});
