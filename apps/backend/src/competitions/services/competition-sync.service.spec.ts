import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { of, throwError } from "rxjs";
import { CompetitionSyncService } from "./competition-sync.service";
import { CompetitionCacheService } from "./competition-cache.service";
import { CompetitionEventNotificationService } from "./competition-event-notification.service";
import { CompetitionEventsDeductionService } from "./competition-events-deduction.service";
import { PrismaService } from "../../prisma/prisma.service";
import { FFDCompetitionItem } from "../interfaces/ffd-competition.interface";

const makeFFDItem = (
  overrides: Partial<FFDCompetitionItem> = {},
): FFDCompetitionItem => ({
  "@id": "/api/competitions/1",
  title: "Test Competition",
  startAt: "2026-06-01T00:00:00Z",
  city: "Paris",
  address1: "1 rue de la Paix",
  zipCode: "75001",
  ...overrides,
});

const makeDetailResponse = (item: FFDCompetitionItem) => ({
  data: item,
});

const makeListResponse = (items: FFDCompetitionItem[]) =>
  of({ data: { "hydra:member": items } });

describe("CompetitionSyncService", () => {
  let service: CompetitionSyncService;
  let prisma: DeepMockProxy<PrismaClient>;
  let httpService: jest.Mocked<Pick<HttpService, "get">>;
  let configService: jest.Mocked<Pick<ConfigService, "get">>;
  let cacheService: jest.Mocked<Pick<CompetitionCacheService, "invalidateAll">>;
  let eventNotificationService: jest.Mocked<
    Pick<
      CompetitionEventNotificationService,
      "notifyNewCompetition" | "notifyResultsPublished"
    >
  >;

  let eventsDeductionService: jest.Mocked<
    Pick<CompetitionEventsDeductionService, "deduceForCompetitions">
  >;

  const mockCompetition = { id: "db-comp-1", ffdId: "/api/competitions/1" };

  beforeEach(async () => {
    prisma = mockDeep<PrismaClient>();
    // Default: competitions look pre-existing and have no results, so
    // notification dispatch stays quiet unless a test opts in.
    prisma.competition.findUnique.mockResolvedValue(mockCompetition as any);
    prisma.competition.findMany.mockResolvedValue([]);

    httpService = {
      get: jest.fn(),
    };

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        const config: Record<string, unknown> = {
          "ffd.apiBaseUrl": "https://api.ffd.fr",
          "ffd.apiPath": "/api/competitions",
          "ffd.danceFamilies": "standard",
          "ffd.eventCategory": "competition",
          "ffd.itemsPerPage": 50,
        };
        return config[key] ?? null;
      }),
    };

    cacheService = {
      invalidateAll: jest.fn().mockResolvedValue(undefined),
    };

    eventNotificationService = {
      notifyNewCompetition: jest.fn().mockResolvedValue(undefined),
      notifyResultsPublished: jest.fn().mockResolvedValue(undefined),
    };

    eventsDeductionService = {
      deduceForCompetitions: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompetitionSyncService,
        { provide: PrismaService, useValue: prisma },
        { provide: HttpService, useValue: httpService },
        { provide: ConfigService, useValue: configService },
        { provide: CompetitionCacheService, useValue: cacheService },
        {
          provide: CompetitionEventNotificationService,
          useValue: eventNotificationService,
        },
        {
          provide: CompetitionEventsDeductionService,
          useValue: eventsDeductionService,
        },
      ],
    }).compile();

    service = module.get<CompetitionSyncService>(CompetitionSyncService);
  });

  describe("syncFFDCompetitions", () => {
    it("returns { total, synced, failed } on full success", async () => {
      const items = [
        makeFFDItem({ "@id": "/api/competitions/1", title: "Comp 1" }),
        makeFFDItem({ "@id": "/api/competitions/2", title: "Comp 2" }),
      ];

      httpService.get
        // first call: list
        .mockReturnValueOnce(makeListResponse(items))
        // second call: detail for comp 1
        .mockReturnValueOnce(of(makeDetailResponse(items[0])))
        // third call: detail for comp 2
        .mockReturnValueOnce(of(makeDetailResponse(items[1])));

      prisma.competition.upsert
        .mockResolvedValueOnce({ ...mockCompetition, id: "db-comp-1" } as any)
        .mockResolvedValueOnce({
          ...mockCompetition,
          id: "db-comp-2",
          ffdId: "/api/competitions/2",
        } as any);

      prisma.event.findMany.mockResolvedValue([]);
      prisma.event.createMany.mockResolvedValue({ count: 8 });

      const result = await service.syncFFDCompetitions();

      expect(result).toEqual({ total: 2, synced: 2, failed: 0 });
    });

    it("solves the FFD bot-mitigation redirect chain (JS redirect → 307 → JSON)", async () => {
      const items = [makeFFDItem({ "@id": "/api/competitions/1" })];

      httpService.get
        // 1) un-cookied list hit → JS redirect challenge (HTML) + cookie
        .mockReturnValueOnce(
          of({
            status: 200,
            headers: {
              "content-type": "text/html",
              "set-cookie": ["bot_mitigation_cookie=AAA; Path=/"],
            },
            data: "<script>window.location.href='/redirect_TOKEN====/api/competitions?page=1'</script>",
          }),
        )
        // 2) the /redirect_ path → 307 back to the resource + validated cookie
        .mockReturnValueOnce(
          of({
            status: 307,
            headers: {
              location: "https://api.ffd.fr/api/competitions?page=1",
              "set-cookie": ["bot_mitigation_cookie=BBB; Path=/"],
            },
            data: "",
          }),
        )
        // 3) resource now returns the real JSON list
        .mockReturnValueOnce(
          of({
            status: 200,
            headers: { "content-type": "application/ld+json" },
            data: { "hydra:member": items },
          }),
        )
        // 4) detail (cookie already validated, returns JSON directly)
        .mockReturnValueOnce(of(makeDetailResponse(items[0])));

      prisma.competition.upsert.mockResolvedValueOnce(mockCompetition as any);
      prisma.event.findMany.mockResolvedValue([]);
      prisma.event.createMany.mockResolvedValue({ count: 4 });

      const result = await service.syncFFDCompetitions();

      expect(result).toEqual({ total: 1, synced: 1, failed: 0 });
      // the cookie picked up from the chain is sent on later requests
      const lastCall = httpService.get.mock.calls.at(-1);
      expect(
        (lastCall?.[1] as { headers?: Record<string, string> })?.headers
          ?.Cookie,
      ).toContain("bot_mitigation_cookie=BBB");
    });

    it("calls cacheService.invalidateAll after successful sync", async () => {
      const items = [makeFFDItem()];

      httpService.get
        .mockReturnValueOnce(makeListResponse(items))
        .mockReturnValueOnce(of(makeDetailResponse(items[0])));

      prisma.competition.upsert.mockResolvedValue(mockCompetition as any);
      prisma.event.findMany.mockResolvedValue([]);
      prisma.event.createMany.mockResolvedValue({ count: 4 });

      await service.syncFFDCompetitions();

      expect(cacheService.invalidateAll).toHaveBeenCalledTimes(1);
    });

    it("throws BadRequestException when all competitions fail to sync", async () => {
      const items = [
        makeFFDItem({ "@id": "/api/competitions/1" }),
        makeFFDItem({ "@id": "/api/competitions/2" }),
      ];

      httpService.get
        .mockReturnValueOnce(makeListResponse(items))
        // Both detail calls fail
        .mockReturnValueOnce(throwError(() => new Error("API error")))
        .mockReturnValueOnce(throwError(() => new Error("API error")));

      await expect(service.syncFFDCompetitions()).rejects.toThrow(
        BadRequestException,
      );
    });

    it("does not call invalidateAll when all competitions fail", async () => {
      const items = [makeFFDItem()];

      httpService.get
        .mockReturnValueOnce(makeListResponse(items))
        .mockReturnValueOnce(throwError(() => new Error("API error")));

      await expect(service.syncFFDCompetitions()).rejects.toThrow(
        BadRequestException,
      );

      expect(cacheService.invalidateAll).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when the HttpService list call fails", async () => {
      httpService.get.mockReturnValueOnce(
        throwError(() => new Error("Network timeout")),
      );

      await expect(service.syncFFDCompetitions()).rejects.toThrow(
        BadRequestException,
      );
    });

    it("throws BadRequestException wrapping the original error message on HttpService failure", async () => {
      httpService.get.mockReturnValueOnce(
        throwError(() => new Error("Network timeout")),
      );

      await expect(service.syncFFDCompetitions()).rejects.toThrow(
        /Network timeout/,
      );
    });

    it("returns partial result and does NOT throw when some competitions fail", async () => {
      const items = [
        makeFFDItem({ "@id": "/api/competitions/1", title: "Comp 1" }),
        makeFFDItem({ "@id": "/api/competitions/2", title: "Comp 2" }),
      ];

      httpService.get
        .mockReturnValueOnce(makeListResponse(items))
        // first detail: success
        .mockReturnValueOnce(of(makeDetailResponse(items[0])))
        // second detail: failure
        .mockReturnValueOnce(
          throwError(() => new Error("detail fetch failed")),
        );

      prisma.competition.upsert.mockResolvedValue(mockCompetition as any);
      prisma.event.findMany.mockResolvedValue([]);
      prisma.event.createMany.mockResolvedValue({ count: 4 });

      const result = await service.syncFFDCompetitions();

      expect(result).toEqual({ total: 2, synced: 1, failed: 1 });
    });

    it("calls invalidateAll even with partial failures", async () => {
      const items = [
        makeFFDItem({ "@id": "/api/competitions/1", title: "Comp 1" }),
        makeFFDItem({ "@id": "/api/competitions/2", title: "Comp 2" }),
      ];

      httpService.get
        .mockReturnValueOnce(makeListResponse(items))
        .mockReturnValueOnce(of(makeDetailResponse(items[0])))
        .mockReturnValueOnce(
          throwError(() => new Error("detail fetch failed")),
        );

      prisma.competition.upsert.mockResolvedValue(mockCompetition as any);
      prisma.event.findMany.mockResolvedValue([]);
      prisma.event.createMany.mockResolvedValue({ count: 4 });

      await service.syncFFDCompetitions();

      expect(cacheService.invalidateAll).toHaveBeenCalledTimes(1);
    });

    it("returns total=0, synced=0, failed=0 when the FFD API returns an empty list", async () => {
      httpService.get.mockReturnValueOnce(makeListResponse([]));

      const result = await service.syncFFDCompetitions();

      expect(result).toEqual({ total: 0, synced: 0, failed: 0 });
    });

    it("calls invalidateAll even when the list is empty", async () => {
      httpService.get.mockReturnValueOnce(makeListResponse([]));

      await service.syncFFDCompetitions();

      expect(cacheService.invalidateAll).toHaveBeenCalledTimes(1);
    });

    it("upserts competitions using ffdId as the where clause", async () => {
      const item = makeFFDItem({ "@id": "/api/competitions/99" });

      httpService.get
        .mockReturnValueOnce(makeListResponse([item]))
        .mockReturnValueOnce(of(makeDetailResponse(item)));

      prisma.competition.upsert.mockResolvedValue({
        id: "db-99",
        ffdId: "/api/competitions/99",
      } as any);
      prisma.event.findMany.mockResolvedValue([]);
      prisma.event.createMany.mockResolvedValue({ count: 4 });

      await service.syncFFDCompetitions();

      expect(prisma.competition.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ffdId: "/api/competitions/99" },
        }),
      );
    });

    it("maps the real FFD programme fields and seeds generic events for registration", async () => {
      const items = [
        makeFFDItem({
          "@id": "/api/competitions/1",
          title: "Comp 1",
          endAt: "2026-06-02T00:00:00Z",
          danceEventDescription: "Standard & Latine, Classificatrices + Opens",
          fileEvents: { path: "/uploads/programme-1.pdf" },
        }),
      ];

      httpService.get
        .mockReturnValueOnce(makeListResponse(items))
        .mockReturnValueOnce(of(makeDetailResponse(items[0])));

      prisma.competition.upsert.mockResolvedValueOnce(mockCompetition as any);
      prisma.event.findMany.mockResolvedValue([]);
      prisma.event.createMany.mockResolvedValue({ count: 4 });

      await service.syncFFDCompetitions();

      // real programme info mapped onto the competition
      expect(prisma.competition.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            eventsDescription: "Standard & Latine, Classificatrices + Opens",
            programUrl: "/uploads/programme-1.pdf",
          }),
        }),
      );
      // generic events are seeded so licensees can still register in-app
      expect(prisma.event.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({ competitionId: mockCompetition.id }),
          ]),
        }),
      );
      // …and flagged as generic for the client
      expect(prisma.competition.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [mockCompetition.id] } },
        data: { eventsSource: "GENERIC" },
      });
    });

    it("does not reseed competitions that already have events", async () => {
      const items = [makeFFDItem()];
      httpService.get
        .mockReturnValueOnce(makeListResponse(items))
        .mockReturnValueOnce(of(makeDetailResponse(items[0])));
      prisma.competition.upsert.mockResolvedValueOnce(mockCompetition as any);
      prisma.event.findMany.mockResolvedValue([
        { competitionId: mockCompetition.id } as any,
      ]);

      await service.syncFFDCompetitions();

      expect(prisma.event.createMany).not.toHaveBeenCalled();
      expect(prisma.competition.updateMany).not.toHaveBeenCalled();
    });

    it("hands the synced competitions to the events deduction", async () => {
      const items = [makeFFDItem()];
      httpService.get
        .mockReturnValueOnce(makeListResponse(items))
        .mockReturnValueOnce(of(makeDetailResponse(items[0])));
      prisma.competition.upsert.mockResolvedValueOnce(mockCompetition as any);
      prisma.event.findMany.mockResolvedValue([]);

      await service.syncFFDCompetitions();

      expect(eventsDeductionService.deduceForCompetitions).toHaveBeenCalledWith(
        [mockCompetition.id],
        expect.any(Function),
      );
    });
  });

  describe("downloadFfdDocument", () => {
    const pdf = Buffer.from("%PDF-1.7 circular");

    it("follows the anti-bot redirects and returns the PDF bytes", async () => {
      httpService.get
        .mockReturnValueOnce(
          of({
            status: 200,
            headers: { "set-cookie": ["bot_mitigation_cookie=AAA; Path=/"] },
            data: Buffer.from(
              "<script>window.location.href='/redirect_TOKEN====/uploads/c.pdf'</script>",
            ),
          }),
        )
        .mockReturnValueOnce(
          of({
            status: 307,
            headers: { location: "https://api.ffd.fr/uploads/c.pdf" },
            data: Buffer.alloc(0),
          }),
        )
        .mockReturnValueOnce(of({ status: 200, headers: {}, data: pdf }));

      const result = await service.downloadFfdDocument(
        "https://api.ffd.fr/uploads/c.pdf",
      );

      expect(result.equals(pdf)).toBe(true);
      expect(httpService.get).toHaveBeenLastCalledWith(
        "https://api.ffd.fr/uploads/c.pdf",
        expect.objectContaining({
          responseType: "arraybuffer",
          maxContentLength: 10 * 1024 * 1024,
          headers: expect.objectContaining({
            Cookie: "bot_mitigation_cookie=AAA",
          }) as object,
        }),
      );
    });

    it("rejects an HTTP error instead of returning the error page", async () => {
      httpService.get.mockReturnValueOnce(
        of({ status: 404, headers: {}, data: Buffer.from("Not found") }),
      );

      await expect(
        service.downloadFfdDocument("https://api.ffd.fr/uploads/missing.pdf"),
      ).rejects.toThrow("HTTP 404");
    });

    it("is the downloader given to the events deduction", async () => {
      const items = [makeFFDItem()];
      httpService.get
        .mockReturnValueOnce(makeListResponse(items))
        .mockReturnValueOnce(of(makeDetailResponse(items[0])))
        .mockReturnValueOnce(of({ status: 200, headers: {}, data: pdf }));
      prisma.competition.upsert.mockResolvedValueOnce(mockCompetition as any);
      prisma.event.findMany.mockResolvedValue([]);

      await service.syncFFDCompetitions();
      const downloader =
        eventsDeductionService.deduceForCompetitions.mock.calls[0][1];

      await expect(
        downloader("https://api.ffd.fr/uploads/c.pdf"),
      ).resolves.toEqual(pdf);
    });
  });

  describe("sync-triggered notifications", () => {
    const runSyncOnce = () => {
      const item = makeFFDItem({ "@id": "/api/competitions/1" });
      httpService.get
        .mockReturnValueOnce(makeListResponse([item]))
        .mockReturnValueOnce(of(makeDetailResponse(item)));
      prisma.competition.upsert.mockResolvedValue(mockCompetition as any);
      prisma.event.findMany.mockResolvedValue([]);
      prisma.event.createMany.mockResolvedValue({ count: 4 });
      return service.syncFFDCompetitions();
    };

    it("notifies eligible licensees for a NEWLY created competition", async () => {
      // findUnique(null) → competition did not exist → treated as new
      prisma.competition.findUnique.mockResolvedValue(null);
      prisma.competition.findMany.mockImplementation(
        (args?: {
          select?: { events?: unknown };
          where?: { events?: { some?: { results?: unknown } } };
        }) => {
          // new-competition dispatch loads events; results dispatch loads ids
          if (args?.select?.events) {
            return Promise.resolve([
              {
                id: mockCompetition.id,
                title: "Comp 1",
                location: "Paris",
                date: new Date("2026-06-01"),
                events: [{ category: "Latin", level: null, ageGroup: "Adult" }],
              },
            ]) as any;
          }
          return Promise.resolve([]) as any;
        },
      );

      await runSyncOnce();

      expect(
        eventNotificationService.notifyNewCompetition,
      ).toHaveBeenCalledTimes(1);
      expect(
        eventNotificationService.notifyNewCompetition,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ id: mockCompetition.id }),
      );
    });

    it("does NOT notify new-competition for an already-existing competition", async () => {
      prisma.competition.findUnique.mockResolvedValue(mockCompetition as any);

      await runSyncOnce();

      expect(
        eventNotificationService.notifyNewCompetition,
      ).not.toHaveBeenCalled();
    });

    it("notifies participants when a synced competition has results", async () => {
      prisma.competition.findUnique.mockResolvedValue(mockCompetition as any);
      prisma.competition.findMany.mockImplementation(
        (args?: {
          select?: { events?: unknown };
          where?: { events?: { some?: { results?: unknown } } };
        }) => {
          // results dispatch: competitions that have at least one result row
          if (args?.where?.events?.some?.results) {
            return Promise.resolve([{ id: mockCompetition.id }]) as any;
          }
          return Promise.resolve([]) as any;
        },
      );

      await runSyncOnce();

      expect(
        eventNotificationService.notifyResultsPublished,
      ).toHaveBeenCalledWith(mockCompetition.id);
    });

    it("does NOT notify results when the competition has none", async () => {
      prisma.competition.findUnique.mockResolvedValue(mockCompetition as any);
      prisma.competition.findMany.mockResolvedValue([]);

      await runSyncOnce();

      expect(
        eventNotificationService.notifyResultsPublished,
      ).not.toHaveBeenCalled();
    });
  });
});
