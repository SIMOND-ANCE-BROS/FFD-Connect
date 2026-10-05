import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ThrottlerModule } from "@nestjs/throttler";
import { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { PaginationParamsDto } from "../common/dto/pagination-params.dto";
import { ThrottlerUserGuard } from "../common/guards/throttler-user.guard";
import { CompetitionsController } from "./competitions.controller";
import { CompetitionManagementService } from "./services/competition-management.service";
import { CompetitionQueryService } from "./services/competition-query.service";
import { CompetitionRegistrationService } from "./services/competition-registration.service";
import { CompetitionResultsService } from "./services/competition-results.service";

describe("CompetitionsController", () => {
  let controller: CompetitionsController;
  let queryService: jest.Mocked<CompetitionQueryService>;
  let registrationService: jest.Mocked<CompetitionRegistrationService>;
  let resultsService: jest.Mocked<CompetitionResultsService>;
  let managementService: jest.Mocked<CompetitionManagementService>;

  const mockQueryService = {
    findAll: jest.fn(),
    findActiveCompetition: jest.fn(),
    findOne: jest.fn(),
    findOneForUser: jest.fn(),
  };

  const mockRegistrationService = {
    register: jest.fn(),
    unregister: jest.fn(),
    registerMember: jest.fn(),
    unregisterMember: jest.fn(),
    confirmRegistration: jest.fn(),
    getPendingRegistrationsForClub: jest.fn(),
  };

  const mockResultsService = {
    getResults: jest.fn(),
    getEventRegistrations: jest.fn(),
    getUserRegistrations: jest.fn(),
    checkIn: jest.fn(),
    generateVolunteerToken: jest.fn(),
    checkInAsVolunteer: jest.fn(),
  };

  const mockManagementService = {
    enqueueSyncFFD: jest.fn(),
    getSyncStatus: jest.fn(),
    getRegulationConstants: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };

  const req = (userId: string, role = "LICENSEE") =>
    ({ user: { userId, role } }) as any as RequestWithUser;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
      controllers: [CompetitionsController],
      providers: [
        { provide: CompetitionQueryService, useValue: mockQueryService },
        {
          provide: CompetitionRegistrationService,
          useValue: mockRegistrationService,
        },
        { provide: CompetitionResultsService, useValue: mockResultsService },
        {
          provide: CompetitionManagementService,
          useValue: mockManagementService,
        },
      ],
    })
      .overrideGuard(ThrottlerUserGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CompetitionsController>(CompetitionsController);
    queryService = module.get(CompetitionQueryService);
    registrationService = module.get(CompetitionRegistrationService);
    resultsService = module.get(CompetitionResultsService);
    managementService = module.get(CompetitionManagementService);
    jest.clearAllMocks();
  });

  describe("findAll", () => {
    it("extracts userId from req.user and forwards pagination to service", async () => {
      const pagination: PaginationParamsDto = { skip: 0, take: 20 };
      const expected = { data: [], meta: { total: 0 } };
      queryService.findAll.mockResolvedValue(expected as any);

      const result = await controller.findAll(req("user123"), pagination);

      expect(queryService.findAll).toHaveBeenCalledWith("user123", pagination);
      expect(result).toBe(expected);
    });

    it("propagates service errors", async () => {
      queryService.findAll.mockRejectedValue(new NotFoundException());
      await expect(controller.findAll(req("user123"), {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("findActive", () => {
    it("delegates to queryService.findActiveCompetition and returns result", async () => {
      const active = { id: "comp-active", name: "Active comp" };
      queryService.findActiveCompetition.mockResolvedValue(active as any);

      const result = await controller.findActive();

      expect(queryService.findActiveCompetition).toHaveBeenCalledTimes(1);
      expect(result).toBe(active);
    });

    it("propagates NotFoundException when no active competition", async () => {
      queryService.findActiveCompetition.mockRejectedValue(
        new NotFoundException("No active competition"),
      );
      await expect(controller.findActive()).rejects.toThrow(NotFoundException);
    });
  });

  describe("findOne", () => {
    it("calls queryService.findOne with the route param id", async () => {
      const competition = { id: "comp1", name: "Test" };
      queryService.findOne.mockResolvedValue(competition as any);

      const result = await controller.findOne("comp1");

      expect(queryService.findOne).toHaveBeenCalledWith("comp1");
      expect(result).toBe(competition);
    });

    it("propagates NotFoundException", async () => {
      queryService.findOne.mockRejectedValue(new NotFoundException());
      await expect(controller.findOne("missing")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("register", () => {
    it("extracts userId from req.user and calls registrationService.register with all body fields", async () => {
      const body = {
        eventId: "e1",
        partnerName: "Jane",
        coupleAgeGroup: "SENIOR" as any,
        coupleDisciplineLatin: true,
        coupleDisciplineStandard: false,
        partnerUserId: "p1",
        registrantLevel: "BRONZE" as any,
      };
      const registration = { id: "reg1" };
      registrationService.register.mockResolvedValue(registration as any);

      const result = await controller.register("comp1", req("u1"), body);

      expect(registrationService.register).toHaveBeenCalledWith(
        "e1",
        "u1",
        "Jane",
        {
          byOrganizer: false,
          coupleAgeGroup: "SENIOR",
          coupleDisciplineLatin: true,
          coupleDisciplineStandard: false,
          partnerUserId: "p1",
          registrantLevel: "BRONZE",
        },
      );
      expect(result).toBe(registration);
    });

    it("passes undefined optional fields when body only contains eventId", async () => {
      registrationService.register.mockResolvedValue({ id: "reg2" } as any);

      await controller.register("comp1", req("u1"), { eventId: "e1" });

      expect(registrationService.register).toHaveBeenCalledWith(
        "e1",
        "u1",
        undefined,
        {
          byOrganizer: false,
          coupleAgeGroup: undefined,
          coupleDisciplineLatin: undefined,
          coupleDisciplineStandard: undefined,
          partnerUserId: undefined,
          registrantLevel: undefined,
        },
      );
    });

    it("propagates BadRequestException when user is already registered", async () => {
      registrationService.register.mockRejectedValue(
        new BadRequestException("User is already registered to this event"),
      );

      await expect(
        controller.register("comp1", req("u1"), { eventId: "e1" } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("getResults", () => {
    it("calls resultsService.getResults with competitionId and returns result", async () => {
      const results = { competitionId: "comp1", results: [] };
      resultsService.getResults.mockResolvedValue(results);

      const result = await controller.getResults("comp1");

      expect(resultsService.getResults).toHaveBeenCalledWith("comp1");
      expect(result).toBe(results);
    });

    it("propagates NotFoundException when competition not found", async () => {
      resultsService.getResults.mockRejectedValue(new NotFoundException());
      await expect(controller.getResults("missing")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("getEventRegistrations", () => {
    it("calls resultsService.getEventRegistrations with eventId", async () => {
      const registrations = [{ id: "reg1" }];
      resultsService.getEventRegistrations.mockResolvedValue(
        registrations as any,
      );

      const result = await controller.getEventRegistrations("evt1");

      expect(resultsService.getEventRegistrations).toHaveBeenCalledWith("evt1");
      expect(result).toBe(registrations);
    });
  });

  describe("unregister", () => {
    it("extracts userId from req.user and calls registrationService.unregister", async () => {
      const deleted = { id: "reg1", eventId: "e1", userId: "u1" };
      registrationService.unregister.mockResolvedValue(deleted as any);

      const result = await controller.unregister(req("u1"), { eventId: "e1" });

      expect(registrationService.unregister).toHaveBeenCalledWith(
        "e1",
        "u1",
        {},
      );
      expect(result).toBe(deleted);
    });

    it("propagates NotFoundException when registration not found", async () => {
      registrationService.unregister.mockRejectedValue(new NotFoundException());
      await expect(
        controller.unregister(req("u1"), { eventId: "e1" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getUserRegistrations", () => {
    it("calls resultsService.getUserRegistrations with userId from req", async () => {
      const registrations = [{ id: "reg1" }];
      resultsService.getUserRegistrations.mockResolvedValue(
        registrations as any,
      );

      const result = await controller.getUserRegistrations(req("u1"));

      expect(resultsService.getUserRegistrations).toHaveBeenCalledWith("u1");
      expect(result).toBe(registrations);
    });
  });

  describe("checkIn", () => {
    it("calls resultsService.checkIn with competitionId and qrData from body", async () => {
      const checkInResult = { success: true, message: "OK" };
      resultsService.checkIn.mockResolvedValue(checkInResult as any);

      const result = await controller.checkIn("comp1", { qrData: "qr-code" });

      expect(resultsService.checkIn).toHaveBeenCalledWith("comp1", "qr-code");
      expect(result).toBe(checkInResult);
    });

    it("propagates BadRequestException on invalid QR data", async () => {
      resultsService.checkIn.mockRejectedValue(
        new BadRequestException("Invalid QR code"),
      );
      await expect(
        controller.checkIn("comp1", { qrData: "bad" }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("sync (POST /competitions/sync → 202)", () => {
    it("calls managementService.enqueueSyncFFD and returns jobId", async () => {
      managementService.enqueueSyncFFD.mockResolvedValue({
        jobId: "job-1",
      });

      const result = await controller.sync();

      expect(managementService.enqueueSyncFFD).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ jobId: "job-1" });
    });

    it("propagates ConflictException when sync is already in progress", async () => {
      managementService.enqueueSyncFFD.mockRejectedValue(
        new ConflictException("A sync is already in progress"),
      );

      await expect(controller.sync()).rejects.toThrow(ConflictException);
    });
  });

  describe("getSyncStatus (GET /competitions/sync/status)", () => {
    it("returns status from managementService.getSyncStatus", async () => {
      managementService.getSyncStatus.mockResolvedValue({
        status: "completed",
        jobId: "job-1",
      });

      const result = await controller.getSyncStatus();

      expect(managementService.getSyncStatus).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: "completed", jobId: "job-1" });
    });

    it("returns idle when no sync has been run", async () => {
      managementService.getSyncStatus.mockResolvedValue({
        status: "idle",
      });

      const result = await controller.getSyncStatus();

      expect((result as { status: string }).status).toBe("idle");
    });
  });

  describe("findOneForUser", () => {
    it("passes competitionId and userId to queryService.findOneForUser", async () => {
      const detail = { id: "comp1", events: [] };
      queryService.findOneForUser.mockResolvedValue(detail as any);

      const result = await controller.findOneForUser("comp1", req("u1"));

      expect(queryService.findOneForUser).toHaveBeenCalledWith("comp1", "u1");
      expect(result).toBe(detail);
    });
  });

  describe("getRegulationConstants", () => {
    it("delegates to managementService.getRegulationConstants", async () => {
      const constants = {
        competitionTypes: [],
        eventKinds: [],
        competitionLevels: [],
      };
      managementService.getRegulationConstants.mockReturnValue(
        constants as any,
      );

      const result = await controller.getRegulationConstants();

      expect(managementService.getRegulationConstants).toHaveBeenCalledTimes(1);
      expect(result).toBe(constants);
    });
  });
});
