import { NotFoundException } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import {
  TrackCorrectionReason,
  TrackCorrectionStatus,
  UserRole,
} from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { ROLES_KEY } from "../auth/decorators/roles.decorator";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { ReportTrackReason } from "../tracks/dto/report-track.dto";
import {
  ApproveTrackCorrectionDto,
  CreateTrackCorrectionDto,
  ListTrackCorrectionsQueryDto,
} from "./dto/track-correction.dto";
import { TrackCorrectionsController } from "./track-corrections.controller";
import { TrackCorrectionsQueryService } from "./track-corrections.query-service";
import { TrackCorrectionsService } from "./track-corrections.service";
import { TrackReportController } from "./track-report.controller";

const req = (userId: string, role: string) =>
  ({ user: { userId, email: "x@y.z", role } }) as RequestWithUser;

describe("TrackCorrectionsController", () => {
  const service = {
    create: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
    createFromLegacyReport: jest.fn(),
  };
  const queryService = {
    listForAdmin: jest.fn(),
    listMine: jest.fn(),
    countPending: jest.fn(),
    findOneForAdmin: jest.fn(),
  };
  const controller = new TrackCorrectionsController(
    service as unknown as TrackCorrectionsService,
    queryService as unknown as TrackCorrectionsQueryService,
  );

  beforeEach(() => jest.clearAllMocks());

  it("create délègue avec l'id de l'appelant", async () => {
    service.create.mockResolvedValue({ id: "c1" });
    const dto = {
      trackId: "t1",
      reason: TrackCorrectionReason.MPM,
      bpm: 62,
    };
    await expect(
      controller.create(dto, req("u1", "LICENSEE")),
    ).resolves.toEqual({ id: "c1" });
    expect(service.create).toHaveBeenCalledWith("u1", dto, false);
  });

  it("create transmet le statut admin (accès à toute piste)", async () => {
    service.create.mockResolvedValue({ id: "c1" });
    const dto = { trackId: "t1", reason: TrackCorrectionReason.MPM, bpm: 62 };
    await controller.create(dto, req("a1", "ADMIN"));
    expect(service.create).toHaveBeenCalledWith("a1", dto, true);
  });

  it("list délègue la requête filtrée", async () => {
    queryService.listForAdmin.mockResolvedValue({ data: [], meta: {} });
    const query = { status: TrackCorrectionStatus.PENDING, skip: 0, take: 10 };
    await controller.list(query);
    expect(queryService.listForAdmin).toHaveBeenCalledWith(query);
  });

  it("listMine lit les propositions de l'appelant", async () => {
    queryService.listMine.mockResolvedValue({ data: [], meta: {} });
    await controller.listMine({ skip: 0, take: 5 }, req("u1", "LICENSEE"));
    expect(queryService.listMine).toHaveBeenCalledWith("u1", {
      skip: 0,
      take: 5,
    });
  });

  it("findOne returns the admin view of one proposal", async () => {
    queryService.findOneForAdmin.mockResolvedValue({ id: "c1" });
    await expect(controller.findOne("c1")).resolves.toEqual({ id: "c1" });
    expect(queryService.findOneForAdmin).toHaveBeenCalledWith("c1");
  });

  it("pendingCount renvoie un objet typé", async () => {
    queryService.countPending.mockResolvedValue(3);
    await expect(controller.pendingCount()).resolves.toEqual({ count: 3 });
  });

  it("approve / reject délèguent avec l'id de l'admin", async () => {
    service.approve.mockResolvedValue({ id: "c1" });
    service.reject.mockResolvedValue({ id: "c1" });
    await controller.approve("c1", { comment: "ok" }, req("a1", "ADMIN"));
    await controller.reject("c1", {}, req("a1", "ADMIN"));
    expect(service.approve).toHaveBeenCalledWith("c1", "a1", { comment: "ok" });
    expect(service.reject).toHaveBeenCalledWith("c1", "a1", {});
  });

  it.each(["list", "findOne", "pendingCount", "approve", "reject"] as const)(
    "%s est réservé aux administrateurs",
    (method) => {
      const handler = TrackCorrectionsController.prototype[method];
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual([UserRole.ADMIN]);
    },
  );

  it.each(["create", "listMine"] as const)(
    "%s est ouvert à tout utilisateur authentifié",
    (method) => {
      const handler = TrackCorrectionsController.prototype[method];
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    },
  );
});

describe("TrackReportController (POST /tracks/:id/report, historique)", () => {
  const service = { createFromLegacyReport: jest.fn() };
  const controller = new TrackReportController(
    service as unknown as TrackCorrectionsService,
  );

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ["TrackReportController.report", TrackReportController.prototype.report],
    [
      "TrackCorrectionsController.create",
      TrackCorrectionsController.prototype.create,
    ],
  ])("%s est limité par utilisateur (10/min)", (_name, handler) => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
    expect(guards).toContain(ThrottlerUserGuard);
    // @nestjs/throttler stocke la limite sous `THROTTLER:LIMIT<nom>`.
    expect(Reflect.getMetadata("THROTTLER:LIMITdefault", handler)).toBe(10);
    expect(Reflect.getMetadata("THROTTLER:TTLdefault", handler)).toBe(60_000);
  });

  it("crée une proposition à partir du signalement", async () => {
    service.createFromLegacyReport.mockResolvedValue(undefined);
    await controller.report(
      "t1",
      { reason: ReportTrackReason.TITLE, message: "typo" },
      req("u1", "LICENSEE"),
    );
    expect(service.createFromLegacyReport).toHaveBeenCalledWith(
      "t1",
      ReportTrackReason.TITLE,
      "typo",
      "u1",
      false,
    );
  });

  it("transmet le statut admin (accès à toute piste)", async () => {
    service.createFromLegacyReport.mockResolvedValue(undefined);
    await controller.report(
      "t1",
      { reason: ReportTrackReason.OTHER },
      req("a1", "ADMIN"),
    );
    expect(service.createFromLegacyReport).toHaveBeenCalledWith(
      "t1",
      ReportTrackReason.OTHER,
      undefined,
      "a1",
      true,
    );
  });

  it("propage le 404", async () => {
    service.createFromLegacyReport.mockRejectedValue(new NotFoundException());
    await expect(
      controller.report(
        "t1",
        { reason: ReportTrackReason.OTHER },
        req("u1", "LICENSEE"),
      ),
    ).rejects.toThrow(NotFoundException);
  });
});

describe("DTO de proposition", () => {
  const errorsOf = async <T extends object>(
    cls: new () => T,
    plain: Record<string, unknown>,
  ) => (await validate(plainToInstance(cls, plain))).map((e) => e.property);

  const valid = {
    trackId: "4f1c2a8e-1b2c-4d5e-8f90-123456789abc",
    reason: "MPM",
  };

  it("accepte une proposition complète", async () => {
    await expect(
      errorsOf(CreateTrackCorrectionDto, {
        ...valid,
        title: "T",
        artist: "A",
        style: "Rumba",
        bpm: 25.5,
        clashTimecodes: [0, 12.5],
        message: "m",
      }),
    ).resolves.toEqual([]);
  });

  it.each([
    ["trackId", { trackId: "pas-un-uuid" }],
    ["reason", { reason: "NOPE" }],
    ["bpm", { bpm: 0 }],
    ["bpm", { bpm: 401 }],
    ["clashTimecodes", { clashTimecodes: [-1] }],
    ["clashTimecodes", { clashTimecodes: Array.from({ length: 11 }, () => 1) }],
    ["message", { message: "x".repeat(501) }],
  ])("refuse un %s invalide", async (property, override) => {
    await expect(
      errorsOf(CreateTrackCorrectionDto, { ...valid, ...override }),
    ).resolves.toContain(property);
  });

  it("borne le commentaire de validation", async () => {
    await expect(
      errorsOf(ApproveTrackCorrectionDto, { comment: "x".repeat(501) }),
    ).resolves.toContain("comment");
  });

  it("valide le filtre de statut", async () => {
    await expect(
      errorsOf(ListTrackCorrectionsQueryDto, { status: "DONE" }),
    ).resolves.toContain("status");
  });

  const reasonCases: Array<[string, Record<string, unknown>, string[]]> = [
    ["single", { reason: "MPM" }, ["MPM"]],
    ["repeated", { reason: ["MPM", "TITLE"] }, ["MPM", "TITLE"]],
    ["comma-separated", { reason: "MPM, TITLE" }, ["MPM", "TITLE"]],
    ["mixed", { reason: ["MPM,DANCE", "OTHER"] }, ["MPM", "DANCE", "OTHER"]],
  ];

  it.each(reasonCases)(
    "accepts a %s reason filter",
    async (_label, plain, expected) => {
      expect(
        plainToInstance(ListTrackCorrectionsQueryDto, plain).reason,
      ).toEqual(expected);
      await expect(
        errorsOf(ListTrackCorrectionsQueryDto, plain),
      ).resolves.toEqual([]);
    },
  );

  it("dedupes a long repeated reason list", async () => {
    const plain = { reason: Array(500).fill("MPM,TITLE").join(",") };
    expect(plainToInstance(ListTrackCorrectionsQueryDto, plain).reason).toEqual(
      ["MPM", "TITLE"],
    );
    await expect(
      errorsOf(ListTrackCorrectionsQueryDto, plain),
    ).resolves.toEqual([]);
  });

  it("refuses more distinct reasons than the enum has values", async () => {
    const tooMany = Array.from(
      { length: Object.keys(TrackCorrectionReason).length + 1 },
      (_, i) => `R${i}`,
    ).join(",");
    await expect(
      errorsOf(ListTrackCorrectionsQueryDto, { reason: tooMany }),
    ).resolves.toContain("reason");
  });

  it("refuses an unknown reason", async () => {
    await expect(
      errorsOf(ListTrackCorrectionsQueryDto, { reason: "MPM,NOPE" }),
    ).resolves.toContain("reason");
  });

  it("trims the search, then requires 2 to 100 characters", async () => {
    expect(
      plainToInstance(ListTrackCorrectionsQueryDto, { q: "  pa  " }).q,
    ).toBe("pa");
    await expect(
      errorsOf(ListTrackCorrectionsQueryDto, { q: "  pa  " }),
    ).resolves.toEqual([]);
    await expect(
      errorsOf(ListTrackCorrectionsQueryDto, { q: " p " }),
    ).resolves.toContain("q");
    await expect(
      errorsOf(ListTrackCorrectionsQueryDto, { q: "x".repeat(101) }),
    ).resolves.toContain("q");
  });

  it("accepts a track filter by UUID only", async () => {
    await expect(
      errorsOf(ListTrackCorrectionsQueryDto, {
        trackId: "4f1c2a8e-1b2c-4d5e-8f90-123456789abc",
      }),
    ).resolves.toEqual([]);
    await expect(
      errorsOf(ListTrackCorrectionsQueryDto, { trackId: "t1" }),
    ).resolves.toContain("trackId");
  });
});
