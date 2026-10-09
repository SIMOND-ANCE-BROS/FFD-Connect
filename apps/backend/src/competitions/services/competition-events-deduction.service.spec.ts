import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { EventsSource, PrismaClient } from "@prisma/client";
import { DeepMockProxy, mockDeep } from "jest-mock-extended";
import { CircuitBreakerService } from "../../common/circuit-breaker/circuit-breaker.service";
import { PrismaService } from "../../prisma/prisma.service";
import { extractPdfText } from "../events-deduction/pdf-text.util";
import {
  CompetitionEventsDeductionService,
  type FfdDocumentDownloader,
  FfdDocumentTooLargeError,
  MAX_FFD_DOCUMENT_BYTES,
} from "./competition-events-deduction.service";

jest.mock("../events-deduction/pdf-text.util", () => ({
  ...jest.requireActual<object>("../events-deduction/pdf-text.util"),
  extractPdfText: jest.fn(),
}));

const mockedExtractPdfText = extractPdfText as jest.MockedFunction<
  typeof extractPdfText
>;

const API = "https://api.ffdanse.fr";
const CIRCULAR_URL = `${API}/uploads/public/2026/03/10/circulaire.pdf`;
const PDF_BYTES = Buffer.from("%PDF-1.7 fake");

const DESCRIPTION = "Opens<br />Latine et standard Couple<br />Youth / Adulte";
const CIRCULAR_TEXT = `Championnat de France
Latines
Juniors 2 Latines
Youth Standards`;

type Candidate = {
  id: string;
  eventsDescription: string | null;
  circularUrl: string | null;
  eventsSource: EventsSource | null;
  eventsFingerprint: string | null;
  events: {
    category: string;
    ageGroup: string;
    eventType: "COUPLE" | "SOLO";
    level: string | null;
    eventKind: null | "OPEN";
    _count: { registrations: number; results: number; scheduleItems: number };
  }[];
};

const noDependants = { registrations: 0, results: 0, scheduleItems: 0 };

const genericEvents = (): Candidate["events"] =>
  (["Standard", "Latin"] as const).flatMap((category) =>
    (["Adult", "Senior"] as const).map((ageGroup) => ({
      category,
      ageGroup,
      eventType: "COUPLE" as const,
      level: null,
      eventKind: null,
      _count: { ...noDependants },
    })),
  );

const makeCandidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: "comp-1",
  eventsDescription: DESCRIPTION,
  circularUrl: null,
  eventsSource: null,
  eventsFingerprint: null,
  events: genericEvents(),
  ...overrides,
});

describe("CompetitionEventsDeductionService", () => {
  let service: CompetitionEventsDeductionService;
  let prisma: DeepMockProxy<PrismaClient>;
  let config: Record<string, unknown>;
  let breakerFire: jest.Mock;
  let download: jest.MockedFunction<FfdDocumentDownloader>;

  const givenCandidates = (...candidates: Candidate[]) => {
    prisma.competition.findMany.mockResolvedValue(candidates as never);
  };

  const createdEvents = () =>
    (
      prisma.event.createMany.mock.calls[0]?.[0] as
        | { data: { ageGroup: string; category: string; eventKind: string }[] }
        | undefined
    )?.data ?? [];

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = mockDeep<PrismaClient>();
    prisma.$transaction.mockImplementation(
      (fn: (tx: DeepMockProxy<PrismaClient>) => Promise<unknown>) => fn(prisma),
    );
    prisma.registration.count.mockResolvedValue(0);

    config = { "ffd.apiBaseUrl": API, "ffd.deduceEvents": true };
    breakerFire = jest.fn((_key: string, fn: () => Promise<unknown>) => fn());
    download = jest.fn().mockResolvedValue(PDF_BYTES);
    mockedExtractPdfText.mockResolvedValue(CIRCULAR_TEXT);

    const moduleRef = await Test.createTestingModule({
      providers: [
        CompetitionEventsDeductionService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string) => config[key]) },
        },
        { provide: CircuitBreakerService, useValue: { fire: breakerFire } },
      ],
    }).compile();

    service = moduleRef.get(CompetitionEventsDeductionService);
  });

  describe("guards", () => {
    it("does nothing when disabled by configuration", async () => {
      config["ffd.deduceEvents"] = false;
      await service.deduceForCompetitions(["comp-1"], download);
      expect(prisma.competition.findMany).not.toHaveBeenCalled();
    });

    it("is enabled when the setting is absent", () => {
      delete config["ffd.deduceEvents"];
      expect(service.enabled).toBe(true);
    });

    it("does nothing without competitions", async () => {
      await service.deduceForCompetitions([], download);
      expect(prisma.competition.findMany).not.toHaveBeenCalled();
    });

    it("queries a bounded set with the shared select", async () => {
      givenCandidates();
      await service.deduceForCompetitions(["a", "b"], download);
      expect(prisma.competition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ["a", "b"] } },
          take: 2,
        }),
      );
    });

    it("never throws when loading candidates fails", async () => {
      prisma.competition.findMany.mockRejectedValue(new Error("db down"));
      await expect(
        service.deduceForCompetitions(["comp-1"], download),
      ).resolves.toBeUndefined();
    });

    it("never throws when one competition fails", async () => {
      givenCandidates(
        makeCandidate({ id: "bad" }),
        makeCandidate({ id: "good" }),
      );
      prisma.registration.count
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValue(0);

      await service.deduceForCompetitions(["bad", "good"], download);

      expect(prisma.event.createMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("fingerprint", () => {
    it("skips a competition whose documents were already analysed", async () => {
      const candidate = makeCandidate({ circularUrl: CIRCULAR_URL });
      candidate.eventsFingerprint = service.fingerprint(candidate);
      givenCandidates(candidate);

      await service.deduceForCompetitions(["comp-1"], download);

      expect(download).not.toHaveBeenCalled();
      expect(prisma.competition.update).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("changes with the description and the circular", () => {
      const base = { eventsDescription: "a", circularUrl: "b" };
      const fingerprint = service.fingerprint(base);
      expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(service.fingerprint({ ...base, eventsDescription: "c" })).not.toBe(
        fingerprint,
      );
      expect(service.fingerprint({ ...base, circularUrl: null })).not.toBe(
        fingerprint,
      );
    });
  });

  describe("replaceability", () => {
    it("never touches a competition with registrations (and does not download)", async () => {
      const candidate = makeCandidate({ circularUrl: CIRCULAR_URL });
      candidate.events[0]._count.registrations = 1;
      givenCandidates(candidate);

      await service.deduceForCompetitions(["comp-1"], download);

      expect(download).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.competition.update).toHaveBeenCalledWith({
        where: { id: "comp-1" },
        data: { eventsFingerprint: service.fingerprint(candidate) },
        select: { id: true },
      });
    });

    it.each(["results", "scheduleItems"] as const)(
      "never touches a competition whose events have %s",
      async (relation) => {
        const candidate = makeCandidate();
        candidate.events[1]._count[relation] = 2;
        givenCandidates(candidate);

        await service.deduceForCompetitions(["comp-1"], download);

        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it("never replaces events entered by hand (unknown source, custom shape)", async () => {
      const candidate = makeCandidate({
        events: [
          {
            category: "Latin",
            ageGroup: "Youth",
            eventType: "COUPLE",
            level: null,
            eventKind: "OPEN",
            _count: { ...noDependants },
          },
        ],
      });
      givenCandidates(candidate);

      await service.deduceForCompetitions(["comp-1"], download);

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("replaces events previously written by the sync, whatever their shape", async () => {
      givenCandidates(
        makeCandidate({
          eventsSource: EventsSource.DESCRIPTION,
          events: [
            {
              category: "Latin",
              ageGroup: "Youth",
              eventType: "SOLO",
              level: "Avancé",
              eventKind: null,
              _count: { ...noDependants },
            },
          ],
        }),
      );

      await service.deduceForCompetitions(["comp-1"], download);

      expect(prisma.event.deleteMany).toHaveBeenCalledWith({
        where: { competitionId: "comp-1" },
      });
    });

    it("aborts when a registration appeared meanwhile", async () => {
      givenCandidates(makeCandidate());
      prisma.registration.count.mockResolvedValue(1);

      await service.deduceForCompetitions(["comp-1"], download);

      expect(prisma.event.deleteMany).not.toHaveBeenCalled();
      expect(prisma.event.createMany).not.toHaveBeenCalled();
    });
  });

  describe("deduction", () => {
    it("replaces generic events with the description's (DESCRIPTION)", async () => {
      const candidate = makeCandidate();
      givenCandidates(candidate);

      await service.deduceForCompetitions(["comp-1"], download);

      expect(download).not.toHaveBeenCalled();
      expect(prisma.event.deleteMany).toHaveBeenCalled();
      expect(createdEvents()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            competitionId: "comp-1",
            category: "Latin",
            ageGroup: "Youth",
            eventKind: "OPEN",
          }),
        ]),
      );
      expect(createdEvents()).toHaveLength(4);
      expect(prisma.competition.update).toHaveBeenCalledWith({
        where: { id: "comp-1" },
        data: {
          eventsSource: EventsSource.DESCRIPTION,
          eventsFingerprint: service.fingerprint(candidate),
        },
        select: { id: true },
      });
    });

    it("downloads the circular through the circuit breaker (CIRCULAR + union)", async () => {
      givenCandidates(makeCandidate({ circularUrl: CIRCULAR_URL }));

      await service.deduceForCompetitions(["comp-1"], download);

      expect(breakerFire).toHaveBeenCalledWith(
        "ffd-documents",
        expect.any(Function),
      );
      expect(download).toHaveBeenCalledWith(CIRCULAR_URL);
      const ageGroups = createdEvents().map(
        (e) => `${e.eventKind}:${e.category}:${e.ageGroup}`,
      );
      // Circular events + the description's age class the circular lacks.
      expect(ageGroups).toEqual([
        "MAJEURE:Latin:Junior II",
        "MAJEURE:Standard:Youth",
        "OPEN:Latin:Adulte",
        "OPEN:Standard:Adulte",
      ]);
      expect(prisma.competition.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventsSource: EventsSource.CIRCULAR,
          }) as object,
        }),
      );
    });

    it("keeps the description and retries later when the download fails", async () => {
      givenCandidates(makeCandidate({ circularUrl: CIRCULAR_URL }));
      download.mockRejectedValue(new Error("timeout"));

      await service.deduceForCompetitions(["comp-1"], download);

      expect(createdEvents()).toHaveLength(4);
      expect(prisma.competition.update).toHaveBeenCalledWith({
        where: { id: "comp-1" },
        data: { eventsSource: EventsSource.DESCRIPTION },
        select: { id: true },
      });
    });

    it("ignores a circular that is not a PDF (poster image)", async () => {
      givenCandidates(makeCandidate({ circularUrl: CIRCULAR_URL }));
      download.mockResolvedValue(Buffer.from("\x89PNG"));

      await service.deduceForCompetitions(["comp-1"], download);

      expect(mockedExtractPdfText).not.toHaveBeenCalled();
      expect(prisma.competition.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventsSource: EventsSource.DESCRIPTION,
            eventsFingerprint: expect.any(String) as string,
          }) as object,
        }),
      );
    });

    it("does not retry a PDF whose text cannot be extracted", async () => {
      givenCandidates(makeCandidate({ circularUrl: CIRCULAR_URL }));
      mockedExtractPdfText.mockRejectedValue(new Error("bad xref"));

      await service.deduceForCompetitions(["comp-1"], download);

      expect(prisma.competition.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventsSource: EventsSource.DESCRIPTION,
            eventsFingerprint: expect.any(String) as string,
          }) as object,
        }),
      );
    });

    it.each([
      ["another host", "https://evil.example/circulaire.pdf"],
      ["plain http", "http://api.ffdanse.fr/circulaire.pdf"],
      ["a malformed URL", "not a url"],
    ])("never downloads a circular on %s", async (_label, circularUrl) => {
      givenCandidates(makeCandidate({ circularUrl }));

      await service.deduceForCompetitions(["comp-1"], download);

      expect(download).not.toHaveBeenCalled();
    });

    it("never downloads when the FFD base URL is not configured", async () => {
      delete config["ffd.apiBaseUrl"];
      givenCandidates(makeCandidate({ circularUrl: CIRCULAR_URL }));

      await service.deduceForCompetitions(["comp-1"], download);

      expect(download).not.toHaveBeenCalled();
    });

    it("keeps the generic events when nothing is recognised", async () => {
      const candidate = makeCandidate({
        eventsDescription: "Compétitions classificatrices et opens",
        circularUrl: CIRCULAR_URL,
      });
      mockedExtractPdfText.mockResolvedValue("");
      givenCandidates(candidate);

      await service.deduceForCompetitions(["comp-1"], download);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.competition.update).toHaveBeenCalledWith({
        where: { id: "comp-1" },
        data: { eventsFingerprint: service.fingerprint(candidate) },
        select: { id: true },
      });
    });

    it("retries later when nothing is recognised because the download failed", async () => {
      givenCandidates(
        makeCandidate({ eventsDescription: null, circularUrl: CIRCULAR_URL }),
      );
      download.mockRejectedValue(new Error("503"));

      await service.deduceForCompetitions(["comp-1"], download);

      expect(prisma.competition.update).not.toHaveBeenCalled();
    });
  });

  describe("resource bounds", () => {
    it("keeps generic events and never retries an oversized circular", async () => {
      const candidate = makeCandidate({
        eventsDescription: null,
        circularUrl: CIRCULAR_URL,
      });
      givenCandidates(candidate);
      download.mockRejectedValue(new FfdDocumentTooLargeError(CIRCULAR_URL));

      await service.deduceForCompetitions(["comp-1"], download);

      expect(mockedExtractPdfText).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.competition.update).toHaveBeenCalledWith({
        where: { id: "comp-1" },
        data: { eventsFingerprint: service.fingerprint(candidate) },
        select: { id: true },
      });
    });

    it("ignores a received buffer above the cap without parsing it", async () => {
      givenCandidates(
        makeCandidate({ eventsDescription: null, circularUrl: CIRCULAR_URL }),
      );
      const huge = Buffer.alloc(MAX_FFD_DOCUMENT_BYTES + 1);
      huge.write("%PDF");
      download.mockResolvedValue(huge);

      await service.deduceForCompetitions(["comp-1"], download);

      expect(mockedExtractPdfText).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("downloads and parses one document at a time", async () => {
      givenCandidates(
        makeCandidate({ id: "a", circularUrl: CIRCULAR_URL }),
        makeCandidate({ id: "b", circularUrl: CIRCULAR_URL }),
        makeCandidate({ id: "c", circularUrl: CIRCULAR_URL }),
      );
      let inFlight = 0;
      let maxInFlight = 0;
      download.mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return PDF_BYTES;
      });

      await service.deduceForCompetitions(["a", "b", "c"], download);

      expect(download).toHaveBeenCalledTimes(3);
      expect(maxInFlight).toBe(1);
    });
  });
});
