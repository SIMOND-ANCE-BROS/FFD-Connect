import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { readFileSync } from "fs";
import { join } from "path";
import type { CircuitBreakerService } from "../../common/circuit-breaker/circuit-breaker.service";
import type { PrismaService } from "../../prisma/prisma.service";
import { ImportTopTurnierUrlDto } from "../dto/results-import.dto";
import type { FetchedPage } from "../results-import/topturnier/topturnier-http";
import { TopTurnierPageTooLargeError } from "../results-import/topturnier/topturnier-http";
import {
  CHAIRPERSON_INDEX_HOST,
  CompetitionTopTurnierIndexQueryService,
  TOPTURNIER_INDEX_MAX_CANDIDATES,
} from "./competition-topturnier-index-query.service";
import type { CompetitionTopTurnierImportService } from "./competition-topturnier-import.service";
import { CompetitionTopTurnierUrlImportService } from "./competition-topturnier-url-import.service";

const FIXTURE = readFileSync(
  join(
    __dirname,
    "../results-import/topturnier/__fixtures__/chairperson-index.html",
  ),
  "utf8",
);
const ok = (body: string): FetchedPage => ({
  status: 200,
  location: null,
  body: Buffer.from(body),
});
const notFound: FetchedPage = {
  status: 404,
  location: null,
  body: Buffer.alloc(0),
};
/** 2026-10-20 14:00 Paris. */
const NOW = new Date("2026-10-20T12:00:00Z");

interface Row {
  id: string;
  title: string;
  date: Date;
  endDate: Date | null;
  city: string | null;
  location: string;
  events: { id: string }[];
}

const row = (overrides: Partial<Row> & { id: string }): Row => ({
  title: "Compétition",
  date: new Date("2026-10-16T22:00:00Z"), // 2026-10-17 00:00 Paris
  endDate: null,
  city: null,
  location: "",
  events: [],
  ...overrides,
});

describe("CompetitionTopTurnierIndexQueryService (#801, temporary)", () => {
  let env: Record<string, string | undefined>;
  let findMany: jest.Mock;
  let urlImport: CompetitionTopTurnierUrlImportService;
  let fetchPage: jest.SpyInstance<Promise<FetchedPage>, [URL]>;
  let service: CompetitionTopTurnierIndexQueryService;

  beforeEach(() => {
    env = { TOPTURNIER_URL_IMPORT_ENABLED: "true" };
    const config = {
      get: (key: string) => env[key],
    } as unknown as ConfigService;
    const breaker = {
      fire: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
    } as unknown as CircuitBreakerService;
    urlImport = new CompetitionTopTurnierUrlImportService(
      config,
      breaker,
      {} as unknown as CompetitionTopTurnierImportService,
    );
    fetchPage = jest
      .spyOn(urlImport, "fetchPage")
      .mockImplementation((url: URL) =>
        Promise.resolve(
          url.searchParams.get("annee") === "2026" ? ok(FIXTURE) : notFound,
        ),
      );
    jest.spyOn(urlImport, "sleep").mockResolvedValue(undefined);
    findMany = jest.fn().mockResolvedValue([]);
    service = new CompetitionTopTurnierIndexQueryService(
      { competition: { findMany } } as unknown as PrismaService,
      urlImport,
    );
  });

  it("is off unless the flag is « true » and the site allowlisted (404, no request)", async () => {
    env.TOPTURNIER_URL_IMPORT_ENABLED = "false";
    expect(service.isAvailable()).toBe(false);
    await expect(service.list(undefined, NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    env.TOPTURNIER_URL_IMPORT_ENABLED = "true";
    env.TOPTURNIER_ALLOWED_HOSTS = "results.example.org";
    expect(service.isAvailable()).toBe(false);
    await expect(service.list(undefined, NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(fetchPage).not.toHaveBeenCalled();
    env.TOPTURNIER_ALLOWED_HOSTS = `results.example.org,${CHAIRPERSON_INDEX_HOST}`;
    expect(service.isAvailable()).toBe(true);
  });

  it("reads at most the current and previous year, over https, spaced", async () => {
    const result = await service.list(undefined, NOW);
    expect(fetchPage.mock.calls.map(([url]) => url.href)).toEqual([
      `https://${CHAIRPERSON_INDEX_HOST}/resultats/index.php?annee=2026`,
      `https://${CHAIRPERSON_INDEX_HOST}/resultats/index.php?annee=2025`,
    ]);
    expect(result.years).toEqual([2026, 2025]);
    // 2025 answered 404: an empty year, not an error.
    expect(result.items).toHaveLength(6);
    expect(result.truncated).toBe(false);
    expect(result.items.map((i) => i.date)).toEqual(
      [...result.items.map((i) => i.date)].sort().reverse(),
    );
    for (const item of result.items) {
      expect(item.exportUrl).toMatch(
        /^https:\/\/chairperson\.ddsbagnols\.com\/resultats\/[^/]+\/index\.htm$/,
      );
    }
  });

  it("reads one year on demand, only the current or the previous one", async () => {
    await service.list(2025, NOW);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0][0].searchParams.get("annee")).toBe("2025");
    await expect(service.list(2024, NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.list(2027, NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("uses the Paris year on New Year's Eve night", async () => {
    // 2027-01-01 00:30 Paris = 2026-12-31 23:30 UTC.
    const result = await service.list(
      undefined,
      new Date("2026-12-31T23:30:00Z"),
    );
    expect(result.years).toEqual([2027, 2026]);
  });

  it("matches explicitly: unique, ambiguous, none, and flags existing results", async () => {
    findMany.mockResolvedValue([
      row({ id: "c-exemple", city: "Exempleville", events: [{ id: "e1" }] }),
      row({ id: "c-fictive-1", title: "Open A", location: "Fictiveville" }),
      row({ id: "c-fictive-2", title: "Open B", city: "Fictiveville" }),
      // Saturday–Sunday competition: the Sunday entry matches it.
      row({
        id: "c-villefictive",
        title: "Championnat de France",
        city: "Villefictive",
        date: new Date("2026-05-22T22:00:00Z"),
        endDate: new Date("2026-05-23T22:00:00Z"),
      }),
      row({
        id: "c-saint-exemple",
        city: "Saint-Exemple-sur-Mer",
        date: new Date("2026-04-17T22:00:00Z"),
      }),
    ]);
    const { items } = await service.list(2026, NOW);
    const byFolder = (folder: string) => {
      const item = items.find((i) => i.exportUrl.includes(`/${folder}/`));
      if (!item) throw new Error(folder);
      return item;
    };
    expect(byFolder("20261017_exempleville")).toMatchObject({
      match: { status: "MATCHED", competitionId: "c-exemple", candidates: [] },
      resultsAlreadyImported: true,
    });
    expect(byFolder("20261017Fictiveville")).toMatchObject({
      match: {
        status: "AMBIGUOUS",
        competitionId: null,
        candidates: [
          { id: "c-fictive-1", title: "Open A" },
          { id: "c-fictive-2", title: "Open B" },
        ],
      },
      resultsAlreadyImported: false,
    });
    expect(byFolder("20260524champfrancedim").match).toMatchObject({
      status: "MATCHED",
      competitionId: "c-villefictive",
    });
    expect(byFolder("20260418stexemplesurmer")).toMatchObject({
      match: { status: "MATCHED", competitionId: "c-saint-exemple" },
      resultsAlreadyImported: false,
    });
    expect(byFolder("20260500_imaginaire").match).toEqual({
      status: "NONE",
      competitionId: null,
      candidates: [],
    });
  });

  it("queries the competitions of the listed days only, bounded, cancelled ones excepted", async () => {
    await service.list(2026, NOW);
    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0] as {
      where: { status: unknown; OR: unknown[] };
      take: number;
      select: Record<string, unknown>;
    };
    expect(args.take).toBe(TOPTURNIER_INDEX_MAX_CANDIDATES);
    expect(args.where.status).toEqual({ not: "CANCELLED" });
    // 6 entries, 5 distinct days.
    expect(args.where.OR).toHaveLength(5);
    expect(args.where.OR[0]).toEqual({
      date: { lt: new Date("2026-10-17T22:00:00Z") },
      OR: [
        { endDate: { gte: new Date("2026-10-16T22:00:00Z") } },
        { endDate: null, date: { gte: new Date("2026-10-16T22:00:00Z") } },
      ],
    });
    expect(args.select).toHaveProperty("events");
  });

  it("does not query the database when no entry has a date", async () => {
    fetchPage.mockResolvedValue(ok("<p>rien</p>"));
    const result = await service.list(2026, NOW);
    expect(result.items).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("holds the site like an import: 409 while an import runs", async () => {
    let release: () => void = () => undefined;
    const busy = urlImport.withSiteLock(
      CHAIRPERSON_INDEX_HOST,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await expect(service.list(undefined, NOW)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(fetchPage).not.toHaveBeenCalled();
    release();
    await busy;
    await expect(service.list(undefined, NOW)).resolves.toBeDefined();
  });

  it("degrades gracefully: unreachable or oversized → 502, open breaker → 503", async () => {
    fetchPage.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(service.list(2026, NOW)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    fetchPage.mockRejectedValueOnce(new TopTurnierPageTooLargeError("/x"));
    await expect(service.list(2026, NOW)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    fetchPage.mockResolvedValueOnce({
      status: 500,
      location: null,
      body: Buffer.alloc(0),
    });
    await expect(service.list(2026, NOW)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    fetchPage.mockRejectedValueOnce(new ServiceUnavailableException());
    await expect(service.list(2026, NOW)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    // The site is freed after each failure.
    await expect(service.list(2026, NOW)).resolves.toBeDefined();
  });

  it("refuses a redirect out of the allowlist (502)", async () => {
    fetchPage.mockResolvedValueOnce({
      status: 302,
      location: "https://evil.example/resultats/index.php",
      body: Buffer.alloc(0),
    });
    await expect(service.list(2026, NOW)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("gives export addresses the URL import accepts as they are", async () => {
    const { items } = await service.list(2026, NOW);
    for (const item of items) {
      const dto = plainToInstance(ImportTopTurnierUrlDto, {
        url: item.exportUrl,
      });
      expect(await validate(dto)).toEqual([]);
    }
  });

  it("deduplicates an export listed in both years", async () => {
    fetchPage.mockImplementation(() => Promise.resolve(ok(FIXTURE)));
    const { items } = await service.list(undefined, NOW);
    expect(items).toHaveLength(6);
    expect(new Set(items.map((i) => i.exportUrl)).size).toBe(6);
  });
});
