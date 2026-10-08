import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import {
  NotificationType,
  Prisma,
  TrackCorrectionReason,
  TrackCorrectionStatus,
  TrackStatus,
  UserRole,
} from "@prisma/client";
import {
  createMockPrismaService,
  MockPrismaService,
} from "../../test/mocks/prisma.mock";
import {
  HIDDEN_TRACK_CASES,
  TrackRow,
  useTrackTable,
} from "../../test/mocks/track-where.mock";
import { withRole } from "../auth/roles";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { TracksService } from "../tracks/tracks.service";
import {
  MAX_ADMINS_NOTIFIED,
  MAX_PENDING_CORRECTIONS_PER_USER,
  MAX_PENDING_CORRECTIONS_PER_USER_PER_TRACK,
  MAX_SERIALIZABLE_ATTEMPTS,
  TrackCorrectionsService,
} from "./track-corrections.service";
import { TrackCorrectionsQueryService } from "./track-corrections.query-service";

const TRACK = {
  title: "España Cañí",
  artist: "Orchestre",
  style: "Paso Doble",
  bpm: 60,
  clashTimecodes: [40, 12.5],
  titleMasked: false,
  blacklisted: false,
};

/** TRACK as an in-memory library row (READY, not Ambiance, not blacklisted). */
const LIBRARY_ROW: TrackRow = {
  ...TRACK,
  id: "t1",
  status: TrackStatus.READY,
};

const createdRow = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  trackId: "t1",
  reason: TrackCorrectionReason.MPM,
  proposedTitle: null,
  proposedArtist: null,
  proposedStyle: null,
  proposedBpm: 62,
  proposesClashes: false,
  proposedClashTimecodes: [],
  message: null,
  status: TrackCorrectionStatus.PENDING,
  reviewComment: null,
  reviewedAt: null,
  createdAt: new Date("2026-10-06T10:00:00Z"),
  track: {
    id: "t1",
    title: "España Cañí",
    artist: "Orchestre",
    titleMasked: false,
  },
  ...overrides,
});

const decisionRow = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  trackId: "t1",
  status: TrackCorrectionStatus.PENDING,
  proposedById: "u1",
  proposedTitle: "Espana Cani",
  proposedArtist: null,
  proposedStyle: null,
  proposedBpm: 62,
  proposesClashes: false,
  proposedClashTimecodes: [],
  track: {
    title: "España Cañí",
    artist: "Orchestre",
    titleMasked: false,
    blacklisted: false,
  },
  ...overrides,
});

describe("TrackCorrectionsService", () => {
  let service: TrackCorrectionsService;
  let prisma: MockPrismaService;
  /** Client de transaction DISTINCT : prouve que les écritures passent par tx. */
  let tx: MockPrismaService;
  let tracks: { updateTrack: jest.Mock };
  let notifications: {
    createForUser: jest.Mock;
    sendToUser: jest.Mock;
    sendToUsers: jest.Mock;
  };
  let queryService: { findOneForAdmin: jest.Mock };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();
    tracks = { updateTrack: jest.fn().mockResolvedValue(undefined) };
    notifications = {
      createForUser: jest.fn().mockResolvedValue(undefined),
      sendToUser: jest
        .fn()
        .mockResolvedValue({ sent: 0, failed: 0, pruned: 0 }),
      sendToUsers: jest
        .fn()
        .mockResolvedValue({ recipients: 0, sent: 0, failed: 0, pruned: 0 }),
    };
    queryService = {
      findOneForAdmin: jest.fn().mockResolvedValue({ id: "c1" }),
    };
    tx = createMockPrismaService();
    // Transaction interactive : le callback reçoit un client de transaction
    // distinct du client principal.
    prisma.$transaction.mockImplementation(((
      cb: (client: unknown) => unknown,
    ) => cb(tx)) as never);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackCorrectionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: TracksService, useValue: tracks },
        { provide: NotificationsService, useValue: notifications },
        { provide: TrackCorrectionsQueryService, useValue: queryService },
      ],
    }).compile();

    service = module.get(TrackCorrectionsService);
  });

  const givenTrack = (track: typeof TRACK | null = TRACK) =>
    prisma.track.findFirst.mockResolvedValue(track as never);
  const givenAdmins = (ids: string[]) =>
    prisma.user.findMany.mockResolvedValue(ids.map((id) => ({ id })) as never);
  const createData = () =>
    tx.trackCorrection.create.mock.calls[0][0].data as Record<string, unknown>;

  // ── create ────────────────────────────────────────────────────────────────

  describe("create", () => {
    beforeEach(() => {
      givenTrack();
      givenAdmins(["admin-1", "admin-2"]);
      tx.trackCorrection.count.mockResolvedValue(0);
      tx.trackCorrection.create.mockResolvedValue(createdRow() as never);
    });

    it("404 si la piste n'existe pas", async () => {
      givenTrack(null);
      await expect(
        service.create("u1", {
          trackId: "t1",
          reason: TrackCorrectionReason.MPM,
          bpm: 62,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(tx.trackCorrection.create).not.toHaveBeenCalled();
    });

    const dto = {
      trackId: "t1",
      reason: TrackCorrectionReason.MPM,
      bpm: 62,
    };

    it.each(HIDDEN_TRACK_CASES)(
      "non-admin : piste %s → même 404 qu'une piste absente",
      async (_label, override) => {
        useTrackTable(prisma, [{ ...LIBRARY_ROW, ...override }]);
        await expect(service.create("u1", dto)).rejects.toThrow(
          new NotFoundException("Track t1 not found"),
        );
        expect(tx.trackCorrection.create).not.toHaveBeenCalled();
      },
    );

    it("non-admin : piste de la bibliothèque acceptée", async () => {
      useTrackTable(prisma, [LIBRARY_ROW]);
      await service.create("u1", dto, false);
      expect(tx.trackCorrection.create).toHaveBeenCalled();
    });

    it.each(HIDDEN_TRACK_CASES)(
      "admin : piste %s toujours atteignable",
      async (_label, override) => {
        useTrackTable(prisma, [{ ...LIBRARY_ROW, ...override }]);
        await service.create("admin-1", dto, true);
        expect(tx.trackCorrection.create).toHaveBeenCalled();
      },
    );

    it("400 sans valeur différente ni message", async () => {
      await expect(
        service.create("u1", {
          trackId: "t1",
          reason: TrackCorrectionReason.TITLE,
          title: "  España Cañí  ",
          artist: "Orchestre",
          style: "paso doble",
          bpm: 60,
          clashTimecodes: [12.5, 40, 40],
          message: "   ",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(tx.trackCorrection.create).not.toHaveBeenCalled();
    });

    it("ne conserve que les valeurs qui diffèrent de la piste", async () => {
      const result = await service.create("u1", {
        trackId: "t1",
        reason: TrackCorrectionReason.MPM,
        title: "España Cañí",
        artist: " Autre orchestre ",
        style: "Paso Doble",
        bpm: 62,
        message: "  tempo trop lent  ",
      });

      expect(createData()).toEqual({
        trackId: "t1",
        proposedById: "u1",
        reason: TrackCorrectionReason.MPM,
        message: "tempo trop lent",
        proposedTitle: null,
        proposedArtist: "Autre orchestre",
        proposedStyle: null,
        proposedBpm: 62,
        proposesClashes: false,
        proposedClashTimecodes: [],
      });
      expect(result).toMatchObject({
        id: "c1",
        trackTitle: "España Cañí",
        proposed: { bpm: 62, clashTimecodes: null },
      });
    });

    it("accepte un message seul (null en base si absent sinon)", async () => {
      await service.create("u1", {
        trackId: "t1",
        reason: TrackCorrectionReason.OTHER,
        message: "son saturé",
      });
      expect(createData()).toMatchObject({
        message: "son saturé",
        proposedBpm: null,
      });
    });

    it("trie et déduplique les clashs proposés, et accepte une danse/un titre nouveaux", async () => {
      givenTrack({ ...TRACK, style: null });
      await service.create("u1", {
        trackId: "t1",
        reason: TrackCorrectionReason.PASO_CLASH,
        title: "Nouveau titre",
        style: "Paso Doble",
        clashTimecodes: [68.3, 12.5, 68.3],
      });
      expect(createData()).toMatchObject({
        message: null,
        proposedTitle: "Nouveau titre",
        proposedStyle: "Paso Doble",
        proposesClashes: true,
        proposedClashTimecodes: [12.5, 68.3],
      });
    });

    it("une liste vide de clashs est une proposition (« aucun clash »)", async () => {
      await service.create("u1", {
        trackId: "t1",
        reason: TrackCorrectionReason.PASO_CLASH,
        clashTimecodes: [],
      });
      expect(createData()).toMatchObject({
        proposesClashes: true,
        proposedClashTimecodes: [],
      });
      expect(notifications.sendToUsers).toHaveBeenCalledWith(
        expect.arrayContaining(["admin-1"]),
        NotificationType.TRACK_REPORT,
        "Proposition de correction",
        "«España Cañí» — Aucun clash",
        expect.any(Object),
      );
    });

    it("titre masqué : la réponse ne sert pas d'oracle sur le titre réel", async () => {
      givenTrack({ ...TRACK, titleMasked: true });
      // Le non-admin devine le vrai titre : la proposition est enregistrée
      // telle quelle, ni 400 ni valeur ignorée.
      const result = await service.create("u1", {
        trackId: "t1",
        reason: TrackCorrectionReason.TITLE,
        title: "España Cañí",
      });
      expect(createData()).toMatchObject({ proposedTitle: "España Cañí" });
      expect(result).toBeDefined();
    });

    it("titre masqué : la réponse renvoie le libellé neutre, pas le titre réel", async () => {
      givenTrack({ ...TRACK, titleMasked: true });
      tx.trackCorrection.create.mockResolvedValue(
        createdRow({
          track: {
            id: "t1",
            title: "España Cañí",
            artist: "Orchestre",
            titleMasked: true,
            blacklisted: false,
          },
        }) as never,
      );
      const result = await service.create("u1", {
        trackId: "t1",
        reason: TrackCorrectionReason.MPM,
        bpm: 62,
      });
      expect(result.trackTitle).toBe("Titre masqué");
      expect(JSON.stringify(result)).not.toContain("España Cañí");
    });

    it("429 au-delà du plafond de propositions en attente sur la piste", async () => {
      tx.trackCorrection.count.mockResolvedValueOnce(
        MAX_PENDING_CORRECTIONS_PER_USER_PER_TRACK,
      );
      const error = await service
        .create("u1", {
          trackId: "t1",
          reason: TrackCorrectionReason.MPM,
          bpm: 62,
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect(tx.trackCorrection.count).toHaveBeenCalledWith({
        where: {
          proposedById: "u1",
          trackId: "t1",
          status: TrackCorrectionStatus.PENDING,
        },
      });
    });

    it("compte et insère dans UNE transaction SERIALIZABLE", async () => {
      await service.create("u1", {
        trackId: "t1",
        reason: TrackCorrectionReason.MPM,
        bpm: 62,
      });
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      expect(prisma.trackCorrection.create).not.toHaveBeenCalled();
      expect(tx.trackCorrection.count).toHaveBeenNthCalledWith(2, {
        where: { proposedById: "u1", status: TrackCorrectionStatus.PENDING },
      });
    });

    it("429 au-delà du plafond GLOBAL de propositions en attente", async () => {
      tx.trackCorrection.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(MAX_PENDING_CORRECTIONS_PER_USER);
      const error = await service
        .create("u1", {
          trackId: "t1",
          reason: TrackCorrectionReason.MPM,
          bpm: 62,
        })
        .catch((e: unknown) => e);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
      expect((error as HttpException).message).toContain(
        String(MAX_PENDING_CORRECTIONS_PER_USER),
      );
      expect(tx.trackCorrection.create).not.toHaveBeenCalled();
    });

    it("rejoue la transaction après un conflit de sérialisation (P2034)", async () => {
      const conflict = new Prisma.PrismaClientKnownRequestError("conflict", {
        code: "P2034",
        clientVersion: "7",
      });
      prisma.$transaction
        .mockRejectedValueOnce(conflict)
        .mockImplementationOnce(((cb: (client: unknown) => unknown) =>
          cb(tx)) as never);
      await expect(
        service.create("u1", {
          trackId: "t1",
          reason: TrackCorrectionReason.MPM,
          bpm: 62,
        }),
      ).resolves.toMatchObject({ id: "c1" });
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it("409 si les conflits de sérialisation persistent", async () => {
      const conflict = new Prisma.PrismaClientKnownRequestError("conflict", {
        code: "P2034",
        clientVersion: "7",
      });
      prisma.$transaction.mockRejectedValue(conflict);
      await expect(
        service.create("u1", {
          trackId: "t1",
          reason: TrackCorrectionReason.MPM,
          bpm: 62,
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).toHaveBeenCalledTimes(
        MAX_SERIALIZABLE_ATTEMPTS,
      );
    });

    it("propage les autres erreurs sans rejouer", async () => {
      prisma.$transaction.mockRejectedValue(new Error("db down"));
      await expect(
        service.create("u1", {
          trackId: "t1",
          reason: TrackCorrectionReason.MPM,
          bpm: 62,
        }),
      ).rejects.toThrow("db down");
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it("notifie chaque admin (requête bornée) avec un résumé et le payload de routage", async () => {
      givenTrack({ ...TRACK, style: "Rumba" });
      await service.create("u1", {
        trackId: "t1",
        reason: TrackCorrectionReason.TITLE,
        title: "Titre",
        artist: "Artiste",
        style: "Paso Doble",
        bpm: 62,
        clashTimecodes: [10, 20],
        message: "merci",
      });

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: withRole(UserRole.ADMIN),
        select: { id: true },
        take: MAX_ADMINS_NOTIFIED,
      });
      // Un seul appel pour tous les administrateurs (#38) au lieu d'un par
      // destinataire : le fil est écrit en une requête, les push sont bornées.
      expect(notifications.sendToUsers).toHaveBeenCalledTimes(1);
      expect(notifications.sendToUsers).toHaveBeenCalledWith(
        ["admin-1", "admin-2"],
        NotificationType.TRACK_REPORT,
        "Proposition de correction",
        "«España Cañí» — Titre « Titre », Artiste « Artiste », Danse Paso Doble, MPM proposé 62, Clashs 10 s, 20 s",
        { type: "TRACK_CORRECTION", correctionId: "c1", trackId: "t1" },
      );
    });

    it("n'échoue pas si une notification admin échoue", async () => {
      notifications.sendToUsers.mockRejectedValueOnce(new Error("fcm"));
      await expect(
        service.create("u1", {
          trackId: "t1",
          reason: TrackCorrectionReason.MPM,
          bpm: 62,
        }),
      ).resolves.toMatchObject({ id: "c1" });
    });

    it("n'échoue pas si la lecture des admins échoue", async () => {
      prisma.user.findMany.mockRejectedValue(new Error("db"));
      await expect(
        service.create("u1", {
          trackId: "t1",
          reason: TrackCorrectionReason.MPM,
          bpm: 62,
        }),
      ).resolves.toMatchObject({ id: "c1" });
    });

    it("n'échoue pas si la lecture des admins échoue avec une valeur non-Error", async () => {
      prisma.user.findMany.mockRejectedValue("boom");
      await expect(
        service.create("u1", {
          trackId: "t1",
          reason: TrackCorrectionReason.MPM,
          bpm: 62,
        }),
      ).resolves.toMatchObject({ id: "c1" });
    });
  });

  // ── createFromLegacyReport ────────────────────────────────────────────────

  describe("createFromLegacyReport", () => {
    beforeEach(() => {
      givenTrack();
      givenAdmins(["admin-1"]);
      tx.trackCorrection.count.mockResolvedValue(0);
      tx.trackCorrection.create.mockResolvedValue({ id: "c9" } as never);
    });

    it("enregistre le motif seul, sans valeur proposée", async () => {
      await service.createFromLegacyReport(
        "t1",
        TrackCorrectionReason.MPM,
        undefined,
        "u1",
      );
      expect(tx.trackCorrection.create).toHaveBeenCalledWith({
        data: {
          trackId: "t1",
          proposedById: "u1",
          reason: TrackCorrectionReason.MPM,
          message: null,
        },
        select: { id: true },
      });
      expect(notifications.sendToUsers).toHaveBeenCalledWith(
        expect.arrayContaining(["admin-1"]),
        NotificationType.TRACK_REPORT,
        "Proposition de correction",
        "«España Cañí» — MPM signalé",
        { type: "TRACK_CORRECTION", correctionId: "c9", trackId: "t1" },
      );
    });

    it("ne recopie PAS le commentaire libre dans la notification (RGPD)", async () => {
      await service.createFromLegacyReport(
        "t1",
        TrackCorrectionReason.PASO_CLASH,
        "  appel décalé  ",
        "u1",
      );
      expect(notifications.sendToUsers).toHaveBeenCalledWith(
        expect.arrayContaining(["admin-1"]),
        NotificationType.TRACK_REPORT,
        "Proposition de correction",
        "«España Cañí» — Clash paso doble signalé",
        expect.any(Object),
      );
      expect(tx.trackCorrection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ message: "appel décalé" }),
        }),
      );
    });

    it("404 si la piste n'existe pas", async () => {
      givenTrack(null);
      await expect(
        service.createFromLegacyReport(
          "t1",
          TrackCorrectionReason.OTHER,
          undefined,
          "u1",
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it.each(HIDDEN_TRACK_CASES)(
      "non-admin : piste %s → même 404 qu'une piste absente",
      async (_label, override) => {
        useTrackTable(prisma, [{ ...LIBRARY_ROW, ...override }]);
        await expect(
          service.createFromLegacyReport(
            "t1",
            TrackCorrectionReason.OTHER,
            undefined,
            "u1",
          ),
        ).rejects.toThrow(new NotFoundException("Track t1 not found"));
        expect(tx.trackCorrection.create).not.toHaveBeenCalled();
        expect(notifications.sendToUser).not.toHaveBeenCalled();
      },
    );

    it("admin : peut signaler une piste hors bibliothèque", async () => {
      useTrackTable(prisma, [{ ...LIBRARY_ROW, status: TrackStatus.PENDING }]);
      await service.createFromLegacyReport(
        "t1",
        TrackCorrectionReason.OTHER,
        undefined,
        "admin-1",
        true,
      );
      expect(tx.trackCorrection.create).toHaveBeenCalled();
    });

    it.each([
      ["par piste", [MAX_PENDING_CORRECTIONS_PER_USER_PER_TRACK]],
      ["global", [0, MAX_PENDING_CORRECTIONS_PER_USER]],
    ])(
      "plafond %s atteint : ne crée rien, sans erreur (contrat 204 historique)",
      async (_label, counts) => {
        for (const c of counts)
          tx.trackCorrection.count.mockResolvedValueOnce(c);
        await expect(
          service.createFromLegacyReport(
            "t1",
            TrackCorrectionReason.OTHER,
            undefined,
            "u1",
          ),
        ).resolves.toBeUndefined();
        expect(tx.trackCorrection.create).not.toHaveBeenCalled();
        expect(notifications.sendToUser).not.toHaveBeenCalled();
      },
    );
  });

  // ── approve ───────────────────────────────────────────────────────────────

  describe("approve", () => {
    beforeEach(() => {
      prisma.trackCorrection.findUnique.mockResolvedValue(
        decisionRow() as never,
      );
      tx.trackCorrection.updateMany.mockResolvedValue({ count: 1 });
    });

    it("404 si la proposition n'existe pas", async () => {
      prisma.trackCorrection.findUnique.mockResolvedValue(null);
      await expect(service.approve("c1", "admin-1", {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it("409 si la proposition est déjà tranchée", async () => {
      prisma.trackCorrection.findUnique.mockResolvedValue(
        decisionRow({ status: TrackCorrectionStatus.REJECTED }) as never,
      );
      await expect(service.approve("c1", "admin-1", {})).rejects.toThrow(
        ConflictException,
      );
      expect(tracks.updateTrack).not.toHaveBeenCalled();
    });

    it("409 si un autre admin a tranché entre-temps, sans toucher à la piste", async () => {
      tx.trackCorrection.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.approve("c1", "admin-1", {})).rejects.toThrow(
        ConflictException,
      );
      expect(tracks.updateTrack).not.toHaveBeenCalled();
      expect(notifications.sendToUser).not.toHaveBeenCalled();
    });

    it("marque APPROVED et applique les valeurs proposées via updateTrack, en transaction", async () => {
      const result = await service.approve("c1", "admin-1", {
        comment: "  merci  ",
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // La décision et la mise à jour de la piste passent par le MÊME tx.
      expect(prisma.trackCorrection.updateMany).not.toHaveBeenCalled();
      expect(tracks.updateTrack.mock.calls[0][4]).toBe(tx);
      expect(tx.trackCorrection.updateMany).toHaveBeenCalledWith({
        where: { id: "c1", status: TrackCorrectionStatus.PENDING },
        data: {
          status: TrackCorrectionStatus.APPROVED,
          reviewedById: "admin-1",
          reviewComment: "merci",
          reviewedAt: expect.any(Date),
        },
      });
      expect(tracks.updateTrack).toHaveBeenCalledWith(
        "t1",
        "admin-1",
        true,
        {
          title: "Espana Cani",
          bpm: 62,
        },
        tx,
      );
      expect(notifications.sendToUser).toHaveBeenCalledWith(
        "u1",
        NotificationType.TRACK_CORRECTION_DECISION,
        "Proposition validée",
        "«Espana Cani» : votre proposition de correction a été validée. Commentaire : merci",
        {
          type: "TRACK_CORRECTION_DECISION",
          correctionId: "c1",
          trackId: "t1",
          status: TrackCorrectionStatus.APPROVED,
        },
      );
      expect(result).toEqual({ id: "c1" });
      expect(queryService.findOneForAdmin).toHaveBeenCalledWith("c1");
    });

    it("les valeurs de l'admin remplacent celles de la proposition", async () => {
      prisma.trackCorrection.findUnique.mockResolvedValue(
        decisionRow({
          proposedTitle: null,
          proposedBpm: null,
          proposedArtist: "A",
          proposedStyle: "Paso Doble",
          proposesClashes: true,
          proposedClashTimecodes: [1, 2],
        }) as never,
      );
      await service.approve("c1", "admin-1", {
        title: "Titre admin",
        style: "  ",
        bpm: 61,
        clashTimecodes: [3],
      });
      expect(tracks.updateTrack).toHaveBeenCalledWith(
        "t1",
        "admin-1",
        true,
        {
          title: "Titre admin",
          artist: "A",
          style: "Paso Doble",
          bpm: 61,
          clashTimecodes: [3],
        },
        tx,
      );
    });

    it("applique les clashs proposés (y compris une liste vide)", async () => {
      prisma.trackCorrection.findUnique.mockResolvedValue(
        decisionRow({
          proposedTitle: null,
          proposedBpm: null,
          proposesClashes: true,
          proposedClashTimecodes: [],
        }) as never,
      );
      await service.approve("c1", "admin-1", {});
      expect(tracks.updateTrack).toHaveBeenCalledWith(
        "t1",
        "admin-1",
        true,
        {
          clashTimecodes: [],
        },
        tx,
      );
    });

    it("propage l'échec de l'application (la transaction annule la décision)", async () => {
      tracks.updateTrack.mockRejectedValue(new NotFoundException());
      await expect(service.approve("c1", "admin-1", {})).rejects.toThrow(
        NotFoundException,
      );
      expect(notifications.sendToUser).not.toHaveBeenCalled();
    });

    it("ne notifie personne si l'auteur a supprimé son compte", async () => {
      prisma.trackCorrection.findUnique.mockResolvedValue(
        decisionRow({ proposedById: null }) as never,
      );
      await service.approve("c1", "admin-1", {});
      expect(notifications.sendToUser).not.toHaveBeenCalled();
    });

    it("masque le titre d'une piste modérée dans la notification à l'auteur", async () => {
      prisma.trackCorrection.findUnique.mockResolvedValue(
        decisionRow({
          track: {
            title: "Vrai",
            artist: "A",
            titleMasked: true,
            blacklisted: false,
          },
        }) as never,
      );
      await service.approve("c1", "admin-1", {});
      expect(notifications.sendToUser).toHaveBeenCalledWith(
        "u1",
        NotificationType.TRACK_CORRECTION_DECISION,
        "Proposition validée",
        "«Titre masqué» : votre proposition de correction a été validée.",
        expect.any(Object),
      );
    });

    it("piste blacklistée entre-temps : ni titre ni artiste dans la notification", async () => {
      prisma.trackCorrection.findUnique.mockResolvedValue(
        decisionRow({
          proposedTitle: null,
          track: {
            title: "Secret",
            artist: "A",
            titleMasked: false,
            blacklisted: true,
          },
        }) as never,
      );
      prisma.trackCorrection.updateMany.mockResolvedValue({ count: 1 });
      await service.reject("c1", "admin-1", {});
      expect(notifications.sendToUser).toHaveBeenCalledWith(
        "u1",
        NotificationType.TRACK_CORRECTION_DECISION,
        "Proposition refusée",
        "«Musique retirée» : votre proposition de correction a été refusée.",
        expect.any(Object),
      );
    });

    it("titre masqué + nouveau titre validé : le libellé neutre reste appliqué", async () => {
      prisma.trackCorrection.findUnique.mockResolvedValue(
        decisionRow({
          track: {
            title: "Vrai",
            artist: "A",
            titleMasked: true,
            blacklisted: false,
          },
        }) as never,
      );
      await service.approve("c1", "admin-1", { title: "Autre vrai titre" });
      const body = notifications.sendToUser.mock.calls[0][3] as string;
      expect(body).toContain("Titre masqué");
      expect(body).not.toContain("Autre vrai titre");
      expect(body).not.toContain("Vrai");
    });

    it("un échec de notification n'annule pas la décision", async () => {
      notifications.sendToUser.mockRejectedValue(new Error("fcm"));
      await expect(service.approve("c1", "admin-1", {})).resolves.toEqual({
        id: "c1",
      });
    });

    it("un échec de notification non-Error est aussi absorbé", async () => {
      notifications.sendToUser.mockRejectedValue("boom");
      await expect(service.approve("c1", "admin-1", {})).resolves.toEqual({
        id: "c1",
      });
    });
  });

  // ── reject ────────────────────────────────────────────────────────────────

  describe("reject", () => {
    beforeEach(() => {
      prisma.trackCorrection.findUnique.mockResolvedValue(
        decisionRow() as never,
      );
      prisma.trackCorrection.updateMany.mockResolvedValue({ count: 1 });
    });

    it("marque REJECTED sans toucher à la piste et notifie l'auteur", async () => {
      await service.reject("c1", "admin-1", { comment: "déjà correct" });

      expect(prisma.trackCorrection.updateMany).toHaveBeenCalledWith({
        where: { id: "c1", status: TrackCorrectionStatus.PENDING },
        data: {
          status: TrackCorrectionStatus.REJECTED,
          reviewedById: "admin-1",
          reviewComment: "déjà correct",
          reviewedAt: expect.any(Date),
        },
      });
      expect(tracks.updateTrack).not.toHaveBeenCalled();
      expect(notifications.sendToUser).toHaveBeenCalledWith(
        "u1",
        NotificationType.TRACK_CORRECTION_DECISION,
        "Proposition refusée",
        "«España Cañí» : votre proposition de correction a été refusée. Commentaire : déjà correct",
        {
          type: "TRACK_CORRECTION_DECISION",
          correctionId: "c1",
          trackId: "t1",
          status: TrackCorrectionStatus.REJECTED,
        },
      );
    });

    it("sans commentaire : reviewComment null et corps sans commentaire", async () => {
      await service.reject("c1", "admin-1", {});
      expect(prisma.trackCorrection.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reviewComment: null }),
        }),
      );
      expect(notifications.sendToUser).toHaveBeenCalledWith(
        "u1",
        NotificationType.TRACK_CORRECTION_DECISION,
        "Proposition refusée",
        "«España Cañí» : votre proposition de correction a été refusée.",
        expect.any(Object),
      );
    });

    it("409 en cas de double décision concurrente", async () => {
      prisma.trackCorrection.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.reject("c1", "admin-1", {})).rejects.toThrow(
        ConflictException,
      );
      expect(notifications.sendToUser).not.toHaveBeenCalled();
    });

    it("409 si déjà validée", async () => {
      prisma.trackCorrection.findUnique.mockResolvedValue(
        decisionRow({ status: TrackCorrectionStatus.APPROVED }) as never,
      );
      await expect(service.reject("c1", "admin-1", {})).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.trackCorrection.updateMany).not.toHaveBeenCalled();
    });
  });
});
