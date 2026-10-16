import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { join } from "path";
import { PrismaService } from "../../prisma/prisma.service";
import { DELETED_USER_ID } from "../../users/account-deletion.core";
import { parseResultsCsv } from "../results-import/results-csv.parser";
import { CompetitionCacheService } from "./competition-cache.service";
import { CompetitionEventNotificationService } from "./competition-event-notification.service";
import {
  CompetitionResultsImportService,
  UNLINKED_RESULT_USER_ID,
  resultImportKey,
} from "./competition-results-import.service";

const FIXTURE = readFileSync(
  join(__dirname, "../../../test/fixtures/results-import/finale-latines.csv"),
  "utf8",
);

const HEADER = "epreuve;tour;classement;couple;dossard;licences";

function rowOf(csv: string, index = 0) {
  return parseResultsCsv(csv).rows[index];
}

describe("CompetitionResultsImportService (#652)", () => {
  let service: CompetitionResultsImportService;
  let prisma: DeepMockProxy<PrismaClient>;
  let cache: { invalidateResults: jest.Mock };
  let notifications: { notifyResultsPublished: jest.Mock };

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    prisma.competition.findUnique.mockResolvedValue({ id: "comp-1" } as never);
    prisma.event.findMany.mockResolvedValue([{ id: "ev-latin" }] as never);
    prisma.license.findMany.mockResolvedValue([]);
    prisma.registration.findMany.mockResolvedValue([]);
    prisma.result.findMany.mockResolvedValue([]);
    prisma.result.createMany.mockReturnValue("create-op" as never);
    prisma.result.updateMany.mockImplementation(
      (args) => ({ update: args }) as never,
    );
    prisma.$transaction.mockResolvedValue([] as never);
    cache = { invalidateResults: jest.fn().mockResolvedValue(undefined) };
    notifications = {
      notifyResultsPublished: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitionResultsImportService,
        { provide: PrismaService, useValue: prisma },
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
      importKey: string;
      details: Record<string, unknown>;
      ranking: number;
      round: string;
    }[];

  describe("resultImportKey", () => {
    it("is a SHA-256 hex digest that never holds the name in clear", () => {
      const key = resultImportKey(
        rowOf(`${HEADER}\nev;Finale;1;Alpha / Bravo;;\n`),
      );
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).not.toContain("alpha");
    });

    it("keys on the bib when there is one, so a corrected label is the same couple", () => {
      const a = rowOf(`${HEADER}\nev;Finale;1;Alpha / Bravo;12;\n`);
      const b = rowOf(`${HEADER}\nev;Finale;2;Alpha / Bravoo;12;\n`);
      expect(resultImportKey(a)).toBe(resultImportKey(b));
    });

    it("keys on the label (case, accents and spaces ignored) without a bib", () => {
      const a = rowOf(`${HEADER}\nev;Finale;1;Élodie  / Bravo;;\n`);
      const b = rowOf(`${HEADER}\nev;Finale;1;elodie / bravo;;\n`);
      expect(resultImportKey(a)).toBe(resultImportKey(b));
    });

    it("differs per event and per round", () => {
      const base = rowOf(`${HEADER}\nev;Finale;1;A / B;12;\n`);
      const otherRound = rowOf(`${HEADER}\nev;1/2 finale;1;A / B;12;\n`);
      const otherEvent = rowOf(`${HEADER}\nev2;Finale;1;A / B;12;\n`);
      expect(resultImportKey(base)).not.toBe(resultImportKey(otherRound));
      expect(resultImportKey(base)).not.toBe(resultImportKey(otherEvent));
    });
  });

  it("404 when the competition does not exist", async () => {
    prisma.competition.findUnique.mockResolvedValue(null);
    await expect(service.importCsv("nope", FIXTURE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("imports the fixture: creates one row per couple, links by licence then by bib", async () => {
    prisma.license.findMany.mockResolvedValue([
      { number: "100002", userId: "user-bravo" },
    ] as never);
    prisma.registration.findMany.mockResolvedValue([
      { eventId: "ev-latin", bibNumber: 31, userId: "user-echo" },
    ] as never);

    const report = await service.importCsv("comp-1", FIXTURE);

    expect(report).toEqual({
      created: 4,
      updated: 0,
      unchanged: 0,
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
    // Bib fallback only for the lines no licence linked.
    expect(prisma.registration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { not: "CANCELLED" },
          OR: [
            { eventId: "ev-latin", bibNumber: 27 },
            { eventId: "ev-latin", bibNumber: 31 },
            { eventId: "ev-latin", bibNumber: 44 },
          ],
        },
      }),
    );
    const rows = createdRows();
    expect(rows.map((r) => r.userId)).toEqual([
      "user-bravo",
      UNLINKED_RESULT_USER_ID,
      "user-echo",
      UNLINKED_RESULT_USER_ID,
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
    expect(prisma.$transaction).toHaveBeenCalledWith(["create-op"]);
    expect(cache.invalidateResults).toHaveBeenCalledWith("comp-1");
    expect(notifications.notifyResultsPublished).toHaveBeenCalledWith("comp-1");
  });

  it("does not link by bib when two accounts hold it, nor for a non-numeric bib", async () => {
    prisma.registration.findMany.mockResolvedValue([
      { eventId: "ev-latin", bibNumber: 12, userId: "u-a" },
      { eventId: "ev-latin", bibNumber: 12, userId: "u-b" },
    ] as never);
    const csv = `${HEADER}\nev-latin;Finale;1;A / B;12;\nev-latin;Finale;2;C / D;A7;\n`;

    const report = await service.importCsv("comp-1", csv);

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
    );
    expect(prisma.license.findMany).not.toHaveBeenCalled();
    expect(prisma.registration.findMany).not.toHaveBeenCalled();
  });

  it("re-running the same file changes nothing (idempotent) but still asks for the notification", async () => {
    const csv = `${HEADER}\nev-latin;Finale;1;Alpha / Bravo;12;\n`;
    const key = resultImportKey(rowOf(csv));
    prisma.result.findMany.mockResolvedValue([
      {
        id: "r1",
        eventId: "ev-latin",
        round: "Finale",
        importKey: key,
        userId: UNLINKED_RESULT_USER_ID,
        ranking: 1,
        // jsonb does not keep key order.
        details: { bib: "12", participant: "Alpha / Bravo" },
      },
    ] as never);

    const report = await service.importCsv("comp-1", csv);

    expect(report).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(cache.invalidateResults).not.toHaveBeenCalled();
    expect(notifications.notifyResultsPublished).toHaveBeenCalledWith("comp-1");
  });

  it("updates a corrected line in place, guarded on its owner, and links it once an account matches", async () => {
    const csv = `${HEADER}\nev-latin;Finale;2;Alpha / Bravo;12;100001\n`;
    const key = resultImportKey(rowOf(csv));
    prisma.result.findMany.mockResolvedValue([
      {
        id: "r1",
        eventId: "ev-latin",
        round: "Finale",
        importKey: key,
        userId: UNLINKED_RESULT_USER_ID,
        ranking: 1,
        details: { participant: "Alpha / Bravo", bib: "12" },
      },
    ] as never);
    prisma.license.findMany.mockResolvedValue([
      { number: "100001", userId: "user-alpha" },
    ] as never);

    const report = await service.importCsv("comp-1", csv);

    expect(report).toMatchObject({ created: 0, updated: 1, linked: 1 });
    expect(prisma.result.updateMany).toHaveBeenCalledWith({
      where: { id: "r1", userId: UNLINKED_RESULT_USER_ID },
      data: {
        ranking: 2,
        userId: "user-alpha",
        details: { participant: "Alpha / Bravo", bib: "12" },
      },
    });
    expect(prisma.result.createMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("keeps an existing account link when the new file has no match", async () => {
    const csv = `${HEADER}\nev-latin;Finale;3;Alpha / Bravo;12;\n`;
    const key = resultImportKey(rowOf(csv));
    prisma.result.findMany.mockResolvedValue([
      {
        id: "r1",
        eventId: "ev-latin",
        round: "Finale",
        importKey: key,
        userId: "user-alpha",
        ranking: 1,
        details: { participant: "Alpha / Bravo", bib: "12" },
      },
    ] as never);

    const report = await service.importCsv("comp-1", csv);

    expect(report.linked).toBe(1);
    expect(prisma.result.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "user-alpha", ranking: 3 }),
      }),
    );
  });

  it("never rewrites a row anonymised by an account deletion (RGPD, #382)", async () => {
    const csv = `${HEADER}\nev-latin;Finale;1;Alpha / Bravo;12;100001\n`;
    const key = resultImportKey(rowOf(csv));
    prisma.result.findMany.mockResolvedValue([
      {
        id: "r1",
        eventId: "ev-latin",
        round: "Finale",
        importKey: key,
        userId: DELETED_USER_ID,
        ranking: 1,
        details: {},
      },
    ] as never);
    prisma.license.findMany.mockResolvedValue([
      { number: "100001", userId: "user-new" },
    ] as never);

    const report = await service.importCsv("comp-1", csv);

    expect(report).toEqual({
      created: 0,
      updated: 0,
      unchanged: 0,
      anonymisedKept: 1,
      linked: 0,
      unlinked: 0,
    });
    expect(prisma.result.updateMany).not.toHaveBeenCalled();
    expect(prisma.result.createMany).not.toHaveBeenCalled();
  });

  it("keeps a label scrubbed for a deleted partner (#395) while updating the ranking", async () => {
    const csv = `${HEADER}\nev-latin;Finale;2;Alpha / Bravo;12;\n`;
    const key = resultImportKey(rowOf(csv));
    prisma.result.findMany.mockResolvedValue([
      {
        id: "r1",
        eventId: "ev-latin",
        round: "Finale",
        importKey: key,
        userId: "user-alpha",
        ranking: 1,
        // The scrub dropped the bib and the club is unknown.
        details: { participant: "Alpha / Partenaire supprimé" },
      },
    ] as never);

    await service.importCsv("comp-1", csv);

    expect(prisma.result.updateMany).toHaveBeenCalledWith({
      where: { id: "r1", userId: "user-alpha" },
      data: {
        ranking: 2,
        userId: "user-alpha",
        details: { participant: "Alpha / Partenaire supprimé" },
      },
    });
  });

  it("treats a non-object stored details as changed", async () => {
    const csv = `${HEADER}\nev-latin;Finale;1;Alpha / Bravo;12;\n`;
    const key = resultImportKey(rowOf(csv));
    prisma.result.findMany.mockResolvedValue([
      {
        id: "r1",
        eventId: "ev-latin",
        round: "Finale",
        importKey: key,
        userId: UNLINKED_RESULT_USER_ID,
        ranking: 1,
        details: null,
      },
    ] as never);

    const report = await service.importCsv("comp-1", csv);
    expect(report.updated).toBe(1);
  });

  describe("all or nothing", () => {
    const rejected = async (csv: string) => {
      const error: unknown = await service
        .importCsv("comp-1", csv)
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

    it("rejects the same couple twice in an event and round", async () => {
      const body = await rejected(
        `${HEADER}\nev-latin;Finale;1;A / B;12;\nev-latin;Finale;2;A / B bis;12;\n`,
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
