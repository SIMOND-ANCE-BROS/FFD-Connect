import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaClient, UserRole } from "@prisma/client";
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
const STAFF = { userId: "staff-1", role: "STAFF", roles: [UserRole.STAFF] };
const CLUB = { userId: "club-1", role: "CLUB", roles: [UserRole.CLUB] };

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
      service.importCsv("comp-1", FIXTURE, STAFF),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.competition.findUnique).not.toHaveBeenCalled();
  });

  it("uses the development key outside production", async () => {
    config = { NODE_ENV: "development" };
    await expect(
      service.importCsv("comp-1", FIXTURE, STAFF),
    ).resolves.toMatchObject({ created: 4 });
  });

  it("404 when the competition does not exist", async () => {
    prisma.competition.findUnique.mockResolvedValue(null);
    await expect(
      service.importCsv("nope", FIXTURE, STAFF),
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

    const report = await service.importCsv("comp-1", FIXTURE, STAFF);

    expect(report).toEqual({
      dryRun: false,
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
    const report = await service.importCsv("comp-1", FIXTURE, STAFF);

    const { dryRun, ...counts } = report;
    expect(dryRun).toBe(false);
    expect(audit.recordOp).toHaveBeenCalledWith({
      actorId: "staff-1",
      action: "COMPETITION_RESULTS_IMPORT",
      targetType: "COMPETITION",
      targetId: "comp-1",
      after: { ...counts, actorRole: "STAFF" },
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

    const report = await service.importCsv("comp-1", csv, STAFF);

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

    const report = await service.importCsv("comp-1", csv, STAFF);

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
      STAFF,
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

    const report = await service.importCsv("comp-1", csv, STAFF);

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

    const report = await service.importCsv("comp-1", csv, STAFF);

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

    const report = await service.importCsv("comp-1", csv, STAFF);

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

    const report = await service.importCsv("comp-1", csv, STAFF);

    expect(report).toEqual({
      dryRun: false,
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

    const report = await service.importCsv("comp-1", csv, STAFF);

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

    const report = await service.importCsv("comp-1", csv, STAFF);

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

    await service.importCsv("comp-1", csv, STAFF);

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

    const report = await service.importCsv("comp-1", csv, STAFF);

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

    await service.importCsv("comp-1", csv, STAFF);

    expect(createdRows()[0]).toMatchObject({
      userId: "came-back",
      details: { participant: "Alpha / Bravo" },
    });
  });

  it("keeps an existing account link when the new file has no match", async () => {
    const csv = `${HEADER}\nev-latin;Finale;3;Alpha / Bravo;12;\n`;
    existingRows([existing(csv, { userId: "user-alpha" })]);

    const report = await service.importCsv("comp-1", csv, STAFF);

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

    await service.importCsv("comp-1", csv, STAFF);

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

    const report = await service.importCsv("comp-1", csv, STAFF);
    expect(report.updated).toBe(1);
  });

  describe("all or nothing", () => {
    const rejected = async (csv: string) => {
      const error: unknown = await service
        .importCsv("comp-1", csv, STAFF)
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
  describe("organising club and dry run (#690)", () => {
    it("records the organising club as such in the audit trail", async () => {
      await service.importCsv("comp-1", FIXTURE, CLUB);
      expect(audit.recordOp).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: "club-1",
          after: expect.objectContaining({ actorRole: "CLUB" }),
        }),
      );
    });

    it("records ADMIN for an administrator, even with a legacy single role", async () => {
      await service.importCsv("comp-1", FIXTURE, {
        userId: "admin-1",
        role: "ADMIN",
      });
      expect(audit.recordOp).toHaveBeenCalledWith(
        expect.objectContaining({
          after: expect.objectContaining({ actorRole: "ADMIN" }),
        }),
      );
    });

    it("dry run: same counts, nothing written, audited, invalidated nor notified", async () => {
      const report = await service.importCsv("comp-1", FIXTURE, CLUB, {
        dryRun: true,
      });
      expect(report).toMatchObject({
        dryRun: true,
        created: 4,
        unlinked: null,
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.result.createMany).not.toHaveBeenCalled();
      expect(audit.recordOp).not.toHaveBeenCalled();
      expect(cache.invalidateResults).not.toHaveBeenCalled();
      expect(notifications.notifyResultsPublished).not.toHaveBeenCalled();
    });

    it("dry run still rejects an invalid file with its lines", async () => {
      const error: unknown = await service
        .importCsv("comp-1", `${HEADER}\nev-latin;Finale;x;A / B;;\n`, CLUB, {
          dryRun: true,
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
    });
  });

  describe("no licence oracle for the organising club (#690)", () => {
    const licenceCsv = `${HEADER}\nev-latin;Finale;1;A / B;12;100001\n`;

    it("withholds every count that depends on what a licence resolves to", async () => {
      prisma.license.findMany.mockResolvedValue([
        { number: "100001", userId: "user-alpha" },
      ] as never);
      const report = await service.importCsv("comp-1", licenceCsv, CLUB, {
        dryRun: true,
      });
      expect(report).toEqual({
        dryRun: true,
        created: 1,
        updated: 0,
        unchanged: 0,
        relinked: null,
        anonymisedKept: null,
        linked: null,
        unlinked: null,
      });
    });

    it("answers the same whether the licence has an account, a deleted one, or none", async () => {
      const answers = [];
      for (const setup of [
        () => prisma.license.findMany.mockResolvedValue([]),
        () =>
          prisma.license.findMany.mockResolvedValue([
            { number: "100001", userId: "user-alpha" },
          ] as never),
        () => {
          prisma.license.findMany.mockResolvedValue([]);
          prisma.erasedResultIdentity.findMany.mockResolvedValue([
            { fingerprint: erasedLicenceFingerprint(KEY, "100001") },
          ] as never);
        },
      ]) {
        setup();
        // An existing row of that couple, as an earlier import left it.
        existingRows([
          existing(licenceCsv, {
            details: { participant: "A / B", bib: "12" },
          }),
        ]);
        answers.push(
          await service.importCsv("comp-1", licenceCsv, CLUB, {
            dryRun: true,
          }),
        );
      }
      expect(answers[1]).toEqual(answers[0]);
      expect(answers[2]).toEqual(answers[0]);
      expect(answers[0]).toMatchObject({ updated: 0, unchanged: 1 });
    });

    it("still counts a corrected rank as updated for the club", async () => {
      existingRows([
        existing(licenceCsv, {
          ranking: 2,
          details: { participant: "A / B", bib: "12" },
        }),
      ]);
      const report = await service.importCsv("comp-1", licenceCsv, CLUB, {
        dryRun: true,
      });
      expect(report).toMatchObject({ created: 0, updated: 1, unchanged: 0 });
    });

    it("STAFF still gets the full counts, and the audit keeps them for a club", async () => {
      prisma.license.findMany.mockResolvedValue([
        { number: "100001", userId: "user-alpha" },
      ] as never);
      const staffReport = await service.importCsv("comp-1", licenceCsv, STAFF, {
        dryRun: true,
      });
      expect(staffReport).toMatchObject({ linked: 1, unlinked: 0 });

      await service.importCsv("comp-1", licenceCsv, CLUB);
      expect(audit.recordOp).toHaveBeenCalledWith(
        expect.objectContaining({
          after: expect.objectContaining({ linked: 1, actorRole: "CLUB" }),
        }),
      );
    });
  });

  describe("event matched by name (#690)", () => {
    const events = [
      {
        id: "ev-latin-adv",
        category: "Latin",
        ageGroup: "Adultes",
        level: "Avancé",
      },
      {
        id: "ev-latin-deb",
        category: "Latin",
        ageGroup: "Adultes",
        level: "Débutant",
      },
      {
        id: "ev-std-jun",
        category: "Standard",
        ageGroup: "Juniors",
        level: null,
      },
    ];

    beforeEach(() => {
      prisma.event.findMany.mockImplementation(((args: {
        where: { id?: unknown };
      }) =>
        Promise.resolve(args.where.id === undefined ? events : [])) as never);
    });

    it("links a line through the event name (discipline label, accents and case ignored)", async () => {
      const report = await service.importCsv(
        "comp-1",
        `${HEADER}\nlatines adultes avance;Finale;1;A / B;12;\nStandards - Juniors;Finale;1;C / D;13;\n`,
        STAFF,
      );
      expect(report.created).toBe(2);
      expect(
        createdRows().map((r) => (r as { eventId?: string }).eventId),
      ).toEqual(["ev-latin-adv", "ev-std-jun"]);
      expect(prisma.event.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { competitionId: "comp-1" },
          take: 500,
        }),
      );
    });

    it("the same couple named once by id and once by name is a duplicate", async () => {
      prisma.event.findMany.mockImplementation(((args: {
        where: { id?: unknown };
      }) =>
        Promise.resolve(
          args.where.id === undefined ? events : [{ id: "ev-std-jun" }],
        )) as never);
      const error: unknown = await service
        .importCsv(
          "comp-1",
          `${HEADER}\nev-std-jun;Finale;1;A / B;12;\nStandard Juniors;Finale;2;A / B;12;\n`,
          STAFF,
        )
        .catch((e: unknown) => e);
      const body = (error as BadRequestException).getResponse() as {
        errors: { line: number; message: string }[];
      };
      expect(body.errors).toEqual([
        {
          line: 3,
          message: "même couple que la ligne 2 pour cette épreuve et ce tour",
        },
      ]);
    });

    it("refuses an ambiguous or unknown name, never guesses", async () => {
      const error: unknown = await service
        .importCsv(
          "comp-1",
          `${HEADER}\nLatines Adultes;Finale;1;A / B;12;\nRock Seniors;Finale;1;C / D;13;\n`,
          STAFF,
        )
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as {
        errors: { line: number; message: string }[];
      };
      expect(body.errors).toEqual([
        {
          line: 2,
          message:
            "nom d'épreuve ambigu (2 épreuves) : utiliser l'identifiant de l'épreuve",
        },
        { line: 3, message: "épreuve inconnue pour cette compétition" },
      ]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe("deleteEventResults (#690)", () => {
    beforeEach(() => {
      prisma.event.findFirst.mockResolvedValue({ id: "ev-latin" } as never);
      prisma.result.deleteMany.mockReturnValue("delete-op" as never);
      prisma.$transaction.mockResolvedValue([
        { count: 2 },
        { id: "a" },
      ] as never);
    });

    it("404 when the event is not one of the competition", async () => {
      prisma.event.findFirst.mockResolvedValue(null);
      await expect(
        service.deleteEventResults("comp-1", "ev-other", CLUB),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.event.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ev-other", competitionId: "comp-1" },
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("removes the imported rows, keeps the erased ones, audits and invalidates the cache", async () => {
      prisma.result.findMany.mockResolvedValue([
        { id: "r1", userId: "user-a", details: { participant: "A / B" } },
        { id: "r2", userId: UNLINKED_RESULT_USER_ID, details: null },
        { id: "r3", userId: DELETED_USER_ID, details: {} },
        {
          id: "r4",
          userId: "user-c",
          details: { participant: "C / Partenaire supprimé" },
        },
      ] as never);

      const report = await service.deleteEventResults(
        "comp-1",
        "ev-latin",
        CLUB,
      );

      expect(report).toEqual({ deleted: 2, anonymisedKept: 2 });
      expect(prisma.result.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { eventId: "ev-latin", importKey: { not: null } },
          take: 5000,
        }),
      );
      expect(prisma.result.deleteMany).toHaveBeenCalledWith({
        where: {
          id: { in: ["r1", "r2"] },
          userId: { not: DELETED_USER_ID },
        },
      });
      expect(audit.recordOp).toHaveBeenCalledWith({
        actorId: "club-1",
        action: "COMPETITION_RESULTS_DELETE",
        targetType: "COMPETITION",
        targetId: "comp-1",
        after: {
          eventId: "ev-latin",
          candidates: 2,
          anonymisedKept: 2,
          actorRole: "CLUB",
        },
      });
      expect(prisma.$transaction).toHaveBeenCalledWith([
        "delete-op",
        "audit-op",
      ]);
      expect(cache.invalidateResults).toHaveBeenCalledWith("comp-1");
      expect(JSON.stringify(audit.recordOp.mock.calls)).not.toContain("A / B");
    });

    it("does not invalidate the cache when nothing was removed", async () => {
      prisma.result.findMany.mockResolvedValue([]);
      prisma.$transaction.mockResolvedValue([
        { count: 0 },
        { id: "a" },
      ] as never);
      const report = await service.deleteEventResults(
        "comp-1",
        "ev-latin",
        STAFF,
      );
      expect(report).toEqual({ deleted: 0, anonymisedKept: 0 });
      expect(cache.invalidateResults).not.toHaveBeenCalled();
    });
  });
});
