import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaClient, UserRole } from "@prisma/client";
import { readFileSync } from "fs";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { join } from "path";
import { AdminAuditService } from "../../admin/admin-audit.service";
import { PrismaService } from "../../prisma/prisma.service";
import {
  EXEMPLEVILLE_EXPORT,
  buildZip,
  zipDirectory,
} from "../results-import/topturnier/__fixtures__/zip-builder";
import { CompetitionCacheService } from "./competition-cache.service";
import { CompetitionResultsImportService } from "./competition-results-import.service";
import { CompetitionTopTurnierImportService } from "./competition-topturnier-import.service";

// A fake key (not a secret): only its length matters.
const KEY = "k".repeat(40);
const STAFF = { userId: "staff-1", role: "STAFF", roles: [UserRole.STAFF] };
const CLUB = { userId: "club-1", role: "CLUB", roles: [UserRole.CLUB] };

const PROGRAM = [
  {
    id: "e-lat-adu-av",
    category: "Latin",
    ageGroup: "Adulte",
    ageGroups: [],
    eventType: "COUPLE",
    level: "Avancé",
    eventKind: "CLASSIFICATRICE",
  },
  {
    id: "e-solo-jun-deb",
    category: "Latin",
    ageGroup: "Solo Junior 1",
    ageGroups: [],
    eventType: "SOLO",
    level: "Débutant",
    eventKind: "CLASSIFICATRICE",
  },
];

async function rejection(promise: Promise<unknown>): Promise<{
  message: string;
  errors: { line: number; message: string }[];
  events?: { folder: string; status: string }[];
}> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as never;
  }
  throw new Error("import accepted");
}

describe("CompetitionTopTurnierImportService (#786)", () => {
  let service: CompetitionTopTurnierImportService;
  let prisma: DeepMockProxy<PrismaClient>;
  let audit: { recordOp: jest.Mock };

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    prisma.competition.findUnique.mockResolvedValue({ id: "comp-1" } as never);
    prisma.event.findMany.mockImplementation(((args: {
      where: { id?: unknown };
    }) =>
      Promise.resolve(
        // Id lookup of the pipeline, then the programme read for the mapping.
        args.where.id ? PROGRAM.map((e) => ({ id: e.id })) : PROGRAM,
      )) as never);
    prisma.license.findMany.mockResolvedValue([]);
    prisma.retiredLicenseNumber.findMany.mockResolvedValue([]);
    prisma.erasedResultIdentity.findMany.mockResolvedValue([]);
    prisma.registration.findMany.mockResolvedValue([]);
    prisma.result.findMany.mockResolvedValue([]);
    prisma.result.createMany.mockReturnValue("create-op" as never);
    prisma.$transaction.mockResolvedValue([] as never);
    audit = { recordOp: jest.fn().mockReturnValue("audit-op") };
    const config: Record<string, string> = {
      RESULTS_PSEUDONYMISATION_KEY: KEY,
      NODE_ENV: "production",
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitionTopTurnierImportService,
        CompetitionResultsImportService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: (name: string) => config[name] },
        },
        { provide: AdminAuditService, useValue: audit },
        {
          provide: CompetitionCacheService,
          useValue: { invalidateResults: jest.fn() },
        },
      ],
    }).compile();
    service = module.get(CompetitionTopTurnierImportService);
  });

  /** The fixture export without its malformed event. */
  const validExport = () =>
    buildZip([
      ...(
        [
          "index.htm",
          "3-nat_adultsavancelat/erg.htm",
          "47-nat_solosjuni2debutantlat/erg.htm",
        ] as const
      ).map((name) => ({
        name: `export/${name}`,
        content: readFileSync(join(EXEMPLEVILLE_EXPORT, name)),
      })),
      { name: "export/3-nat_adultsavancelat/endrunde.jpg", content: "jpg" },
    ]);

  it("imports the matched events through the results pipeline, with the mapping", async () => {
    const report = await service.importArchive("comp-1", validExport(), STAFF);

    expect(report).toMatchObject({ dryRun: false, created: 5, unlinked: 5 });
    expect(report.events.map((e) => [e.folder, e.status, e.eventName])).toEqual(
      [
        ["3-nat_adultsavancelat", "MATCHED", "Latines Adulte Avancé"],
        ["8-nat_sen2intermediairestd", "UNMATCHED", null],
        ["19-nat_youthadultsdebutantlat", "UNMATCHED", null],
        ["25-oc_youthadultslat", "UNMATCHED", null],
        ["27-oc_seni2std", "UNMATCHED", null],
        [
          "47-nat_solosjuni2debutantlat",
          "MATCHED",
          "Latines Solo Junior 1 Débutant",
        ],
        ["60-xyz_mystery", "UNMATCHED", null],
      ],
    );
    const created = prisma.result.createMany.mock.calls[0][0]?.data as {
      eventId: string;
      round: string;
      details: Record<string, unknown>;
    }[];
    expect(created).toHaveLength(5);
    expect(created[0]).toMatchObject({
      eventId: "e-lat-adu-av",
      round: "Classement final",
      details: {
        participant: "Alice MARTIN / Bruno DURAND",
        bib: "22",
        club: "Club Exemple A",
        totalParticipants: 3,
      },
    });
    // Audited with the source, never a name.
    expect(audit.recordOp).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "COMPETITION_RESULTS_IMPORT",
        after: expect.objectContaining({
          source: "TOPTURNIER_UPLOAD",
          matchedEvents: 2,
          skippedEvents: 5,
          actorRole: "STAFF",
        }),
      }),
    );
    expect(JSON.stringify(audit.recordOp.mock.calls)).not.toContain("MARTIN");
  });

  it("previews without writing (dry run), with the club's withheld counts", async () => {
    const report = await service.importArchive("comp-1", validExport(), CLUB, {
      dryRun: true,
    });
    expect(report).toMatchObject({ dryRun: true, created: 5, linked: null });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.recordOp).not.toHaveBeenCalled();
  });

  it("refuses the whole export when a matched ranking is unreadable", async () => {
    prisma.event.findMany.mockImplementation(((args: {
      where: { id?: unknown };
    }) =>
      Promise.resolve(
        args.where.id
          ? []
          : [
              ...PROGRAM,
              {
                id: "e-open",
                category: "Standard",
                ageGroup: "Senior I",
                ageGroups: ["Senior I", "Senior II"],
                eventType: "COUPLE",
                level: null,
                eventKind: "OPEN",
              },
            ],
      )) as never);
    const body = await rejection(
      service.importArchive("comp-1", zipDirectory(EXEMPLEVILLE_EXPORT), STAFF),
    );
    expect(body.message).toBe(
      "Fichier de résultats invalide : rien n'a été importé",
    );
    expect(body.errors).toEqual([
      {
        line: 4,
        message: "« OC, Sen.I/II Standard », ligne 2 : couple manquant",
      },
    ]);
    expect(
      body.events?.find((e) => e.folder === "27-oc_seni2std")?.status,
    ).toBe("INVALID");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses an export where no event matches the programme", async () => {
    prisma.event.findMany.mockResolvedValue([] as never);
    const body = await rejection(
      service.importArchive("comp-1", validExport(), STAFF),
    );
    expect(body.message).toMatch(/Aucune épreuve de l'export/);
    expect(body.events).toHaveLength(7);
  });

  it("refuses an export with more rows than the import accepts", async () => {
    const rows = Array.from(
      { length: 500 },
      (_, i) =>
        `<tr><td>${i + 1}.</td><td>${i + 1}</td><td>P${i}</td><td>C</td></tr>`,
    ).join("");
    const links = Array.from(
      { length: 5 },
      (_, i) => `<a href="${i}-e/index.htm">Nat, Adults Avancé Latin</a>`,
    ).join("");
    const programme = Array.from({ length: 5 }, (_, i) => ({
      ...PROGRAM[0],
      id: `e${i}`,
    }));
    prisma.event.findMany.mockResolvedValue(programme as never);
    // Five identical labels on five identical events: ambiguous, not imported.
    const body = await rejection(
      service.importArchive(
        "comp-1",
        buildZip([
          { name: "index.htm", content: links },
          ...Array.from({ length: 5 }, (_, i) => ({
            name: `${i}-e/erg.htm`,
            content: `<table>${rows}</table>`,
          })),
        ]),
        STAFF,
      ),
    );
    expect(body.message).toMatch(/Aucune épreuve/);

    const many = Array.from({ length: 5 }, (_, i) => ({
      ...PROGRAM[0],
      id: `e${i}`,
      ageGroup: ["Youth", "Adulte", "Senior I", "Senior II", "Senior III"][i],
    }));
    prisma.event.findMany.mockResolvedValue(many as never);
    const labels = ["Youth", "Adults", "Sen.I", "Sen.II", "Sen.III"];
    const body2 = await rejection(
      service.importArchive(
        "comp-1",
        buildZip([
          {
            name: "index.htm",
            content: labels
              .map(
                (l, i) =>
                  `<a href="${i}-e/index.htm">Nat, ${l} Avancé Latin</a>`,
              )
              .join(""),
          },
          ...labels.map((_, i) => ({
            name: `${i}-e/erg.htm`,
            content: `<table>${rows}</table>`,
          })),
        ]),
        STAFF,
      ),
    );
    expect(body2.message).toMatch(/Trop de lignes de classement \(2500/);
  });

  it("refuses an unsafe or invalid archive with a readable message", async () => {
    expect(
      (
        await rejection(
          service.importArchive(
            "comp-1",
            buildZip([{ name: "../index.htm", content: "x" }]),
            STAFF,
          ),
        )
      ).message,
    ).toBe("Chemin interdit dans l'archive");
    expect(
      (
        await rejection(
          service.importArchive(
            "comp-1",
            buildZip([
              { name: "a/index.htm", content: "x" },
              { name: "b/index.htm", content: "x" },
            ]),
            STAFF,
          ),
        )
      ).message,
    ).toMatch(/plusieurs exports/);
    expect(
      (
        await rejection(
          service.importArchive(
            "comp-1",
            buildZip([{ name: "readme.txt", content: "x" }]),
            STAFF,
          ),
        )
      ).message,
    ).toMatch(/index.htm\) introuvable/);
  });

  it("404 when the competition does not exist", async () => {
    prisma.competition.findUnique.mockResolvedValue(null);
    await expect(
      service.importArchive("nope", validExport(), STAFF),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("records the URL source of the temporary import (#787)", async () => {
    const files = new Map<string, Buffer>();
    for (const name of ["index.htm", "3-nat_adultsavancelat/erg.htm"]) {
      files.set(name, readFileSync(join(EXEMPLEVILLE_EXPORT, name)));
    }
    await service.importFromSource(
      "comp-1",
      { read: (p) => Promise.resolve(files.get(p) ?? null) },
      { kind: "TOPTURNIER_URL", url: "example.org/resultats/x/" },
      STAFF,
    );
    expect(audit.recordOp).toHaveBeenCalledWith(
      expect.objectContaining({
        after: expect.objectContaining({
          source: "TOPTURNIER_URL",
          url: "example.org/resultats/x/",
        }),
      }),
    );
  });
});
