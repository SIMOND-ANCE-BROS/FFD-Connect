import { NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { TrackCorrectionReason, TrackCorrectionStatus } from "@prisma/client";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import { PrismaService } from "../prisma/prisma.service";
import { TracksService } from "../tracks/tracks.service";
import {
  trackCorrectionAdminSelect,
  trackCorrectionMineSelect,
} from "../utils/prisma-selects";
import { formatUserName } from "./track-correction.mapper";
import { TrackCorrectionsQueryService } from "./track-corrections.query-service";

const base = {
  id: "c1",
  trackId: "t1",
  reason: TrackCorrectionReason.PASO_CLASH,
  proposedTitle: null,
  proposedArtist: null,
  proposedStyle: null,
  proposedBpm: null,
  proposesClashes: true,
  proposedClashTimecodes: [12.5],
  message: "décalé",
  status: TrackCorrectionStatus.PENDING,
  reviewComment: null,
  reviewedAt: null,
  createdAt: new Date("2026-10-06T10:00:00Z"),
};

const adminRow = {
  ...base,
  track: {
    id: "t1",
    title: "España Cañí",
    artist: "Orchestre",
    style: "Paso Doble",
    bpm: 60,
    rawBpm: 120,
    clashTimecodes: [10],
    titleMasked: false,
    blacklisted: false,
  },
  proposedBy: { id: "u1", firstName: "Jeanne", lastName: "Martin" },
  reviewedBy: null,
};

describe("TrackCorrectionsQueryService", () => {
  let service: TrackCorrectionsQueryService;
  let prisma: MockPrismaService;
  let tracks: { bpmForPatch: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();
    // Règle de TracksService.bpmForPatch reproduite (MPM = BPM brut / 2 ici).
    tracks = {
      bpmForPatch: jest.fn(
        (rawBpm: number, patch: { bpm?: number; style?: string }) =>
          patch.bpm ?? (patch.style && rawBpm > 0 ? rawBpm / 2 : undefined),
      ),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackCorrectionsQueryService,
        { provide: PrismaService, useValue: prisma },
        { provide: TracksService, useValue: tracks },
      ],
    }).compile();
    service = module.get(TrackCorrectionsQueryService);
  });

  describe("listForAdmin", () => {
    it("filtre par statut, sert la file en attente de la plus ancienne à la plus récente, avec diff", async () => {
      prisma.trackCorrection.count.mockResolvedValue(1);
      prisma.trackCorrection.findMany.mockResolvedValue([adminRow] as never);

      const page = await service.listForAdmin({
        status: TrackCorrectionStatus.PENDING,
        skip: 0,
        take: 20,
      });

      expect(prisma.trackCorrection.findMany).toHaveBeenCalledWith({
        where: { status: TrackCorrectionStatus.PENDING },
        orderBy: { createdAt: "asc" },
        skip: 0,
        take: 20,
        select: trackCorrectionAdminSelect,
      });
      expect(page.meta).toEqual({
        total: 1,
        skip: 0,
        take: 20,
        hasMore: false,
      });
      expect(page.data[0]).toEqual({
        id: "c1",
        trackId: "t1",
        reason: TrackCorrectionReason.PASO_CLASH,
        status: TrackCorrectionStatus.PENDING,
        message: "décalé",
        reviewComment: null,
        reviewedAt: null,
        createdAt: base.createdAt,
        proposed: {
          title: null,
          artist: null,
          style: null,
          bpm: null,
          clashTimecodes: [12.5],
        },
        // rawBpm sert au calcul mais n'est pas renvoyé.
        track: {
          id: "t1",
          title: "España Cañí",
          artist: "Orchestre",
          style: "Paso Doble",
          bpm: 60,
          clashTimecodes: [10],
          titleMasked: false,
          blacklisted: false,
        },
        // Rien ne touche au tempo : le MPM actuel est conservé.
        resultingBpm: 60,
        proposer: { id: "u1", name: "Jeanne Martin" },
        reviewer: null,
      });
    });

    it("sans statut : toutes les propositions, plus récentes d'abord, pagination par défaut", async () => {
      prisma.trackCorrection.count.mockResolvedValue(0);
      prisma.trackCorrection.findMany.mockResolvedValue([]);

      await service.listForAdmin({ skip: undefined, take: undefined });

      expect(prisma.trackCorrection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          orderBy: { createdAt: "desc" },
          skip: 0,
          take: 10,
        }),
      );
    });

    it("nomme le relecteur et renvoie null pour des clashs non proposés", async () => {
      prisma.trackCorrection.count.mockResolvedValue(1);
      prisma.trackCorrection.findMany.mockResolvedValue([
        {
          ...adminRow,
          proposesClashes: false,
          proposedClashTimecodes: [],
          proposedBy: null,
          reviewedBy: { id: "a1", firstName: "Admin", lastName: "" },
        },
      ] as never);

      const page = await service.listForAdmin({
        status: TrackCorrectionStatus.APPROVED,
      });

      expect(page.data[0].proposed.clashTimecodes).toBeNull();
      expect(page.data[0].proposer).toBeNull();
      expect(page.data[0].reviewer).toEqual({ id: "a1", name: "Admin" });
    });
  });

  describe("resultingBpm", () => {
    const listOne = async (overrides: Record<string, unknown>) => {
      prisma.trackCorrection.count.mockResolvedValue(1);
      prisma.trackCorrection.findMany.mockResolvedValue([
        { ...adminRow, ...overrides },
      ] as never);
      return (await service.listForAdmin({})).data[0];
    };

    it("danse seule : MPM recalculé depuis le BPM brut (recalcul visible pour l'admin)", async () => {
      const dto = await listOne({ proposedStyle: "Rumba" });
      expect(tracks.bpmForPatch).toHaveBeenCalledWith(120, {
        bpm: undefined,
        style: "Rumba",
      });
      expect(dto.resultingBpm).toBe(60);
      expect(dto.track.bpm).toBe(60);
    });

    it("danse seule avec un autre BPM brut : le MPM résultant diffère de l'actuel", async () => {
      const dto = await listOne({
        proposedStyle: "Rumba",
        track: { ...adminRow.track, rawBpm: 100 },
      });
      expect(dto.resultingBpm).toBe(50);
      expect(dto.track.bpm).toBe(60);
    });

    it("tempo proposé : il prime sur le recalcul", async () => {
      const dto = await listOne({ proposedStyle: "Rumba", proposedBpm: 27 });
      expect(dto.resultingBpm).toBe(27);
    });
  });

  describe("findOneForAdmin", () => {
    it("renvoie la vue admin", async () => {
      prisma.trackCorrection.findUnique.mockResolvedValue(adminRow as never);
      const dto = await service.findOneForAdmin("c1");
      expect(dto.id).toBe("c1");
      expect(prisma.trackCorrection.findUnique).toHaveBeenCalledWith({
        where: { id: "c1" },
        select: trackCorrectionAdminSelect,
      });
    });

    it("404 si absente", async () => {
      prisma.trackCorrection.findUnique.mockResolvedValue(null);
      await expect(service.findOneForAdmin("x")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("listMine", () => {
    it("ne lit que les propositions de l'appelant, plus récentes d'abord", async () => {
      prisma.trackCorrection.count.mockResolvedValue(2);
      prisma.trackCorrection.findMany.mockResolvedValue([
        {
          ...base,
          track: {
            id: "t1",
            title: "Vrai",
            artist: "A",
            titleMasked: true,
            blacklisted: false,
          },
        },
      ] as never);

      const page = await service.listMine("u1", { skip: 0, take: 1 });

      expect(prisma.trackCorrection.findMany).toHaveBeenCalledWith({
        where: { proposedById: "u1" },
        orderBy: { createdAt: "desc" },
        skip: 0,
        take: 1,
        select: trackCorrectionMineSelect,
      });
      expect(page.meta.hasMore).toBe(true);
      // Piste masquée par la modération : libellé neutre côté auteur.
      expect(page.data[0]).toMatchObject({
        trackTitle: "Titre masqué",
        trackArtist: "A",
        status: TrackCorrectionStatus.PENDING,
      });
    });

    it("garde le vrai titre d'une piste non masquée, pagination par défaut", async () => {
      prisma.trackCorrection.count.mockResolvedValue(1);
      prisma.trackCorrection.findMany.mockResolvedValue([
        {
          ...base,
          track: {
            id: "t1",
            title: "Vrai",
            artist: "A",
            titleMasked: false,
            blacklisted: false,
          },
        },
      ] as never);

      const page = await service.listMine("u1", {});

      expect(page.data[0].trackTitle).toBe("Vrai");
      expect(page.meta).toMatchObject({ skip: 0, take: 10 });
    });
  });

  it("listMine ne divulgue ni le titre ni l'artiste d'une piste blacklistée", async () => {
    prisma.trackCorrection.count.mockResolvedValue(1);
    prisma.trackCorrection.findMany.mockResolvedValue([
      {
        ...base,
        track: {
          id: "t1",
          title: "Secret",
          artist: "Artiste secret",
          titleMasked: false,
          blacklisted: true,
        },
      },
    ] as never);

    const page = await service.listMine("u1", {});

    expect(page.data[0]).toMatchObject({
      trackTitle: "Musique retirée",
      trackArtist: "",
    });
    expect(JSON.stringify(page)).not.toContain("Secret");
    // Aucun champ « track » brut ni identité de relecteur côté auteur.
    expect(page.data[0]).not.toHaveProperty("track");
    expect(page.data[0]).not.toHaveProperty("reviewer");
  });

  it("countPending compte les propositions en attente", async () => {
    prisma.trackCorrection.count.mockResolvedValue(4);
    await expect(service.countPending()).resolves.toBe(4);
    expect(prisma.trackCorrection.count).toHaveBeenCalledWith({
      where: { status: TrackCorrectionStatus.PENDING },
    });
  });

  it("formatUserName ignore un nom vide", () => {
    expect(formatUserName({ firstName: " Jeanne ", lastName: "" })).toBe(
      "Jeanne",
    );
  });
});
