import { Test, TestingModule } from "@nestjs/testing";
import type { RequestWithUser } from "../auth/interfaces/jwt-payload.interface";
import { CareerController } from "./career.controller";
import {
  CareerResponse,
  CareerSearchMember,
  CareerService,
} from "./career.service";

const mockCareerService = {
  getMyCareer: jest.fn(),
  searchMembers: jest.fn(),
  getCareerForUser: jest.fn(),
};

const makeRequest = (userId: string): RequestWithUser =>
  ({ user: { userId } }) as unknown as RequestWithUser;

const emptyCareer: CareerResponse = {
  partnerships: [],
  registrations: [],
  results: [],
};

describe("CareerController", () => {
  let controller: CareerController;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      controllers: [CareerController],
      providers: [{ provide: CareerService, useValue: mockCareerService }],
    }).compile();

    controller = module.get<CareerController>(CareerController);
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await module.close();
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // GET /career/me
  // ---------------------------------------------------------------------------
  describe("getMyCareer", () => {
    it("should call careerService.getMyCareer with the userId from the request", async () => {
      mockCareerService.getMyCareer.mockResolvedValue(emptyCareer);
      const req = makeRequest("user-abc");

      await controller.getMyCareer(req);

      expect(mockCareerService.getMyCareer).toHaveBeenCalledWith("user-abc");
      expect(mockCareerService.getMyCareer).toHaveBeenCalledTimes(1);
    });

    it("should return the value from careerService.getMyCareer", async () => {
      const career: CareerResponse = {
        partnerships: [{ id: "p1" }] as CareerResponse["partnerships"],
        registrations: [],
        results: [],
      };
      mockCareerService.getMyCareer.mockResolvedValue(career);

      const result = await controller.getMyCareer(makeRequest("user-abc"));

      expect(result).toEqual(career);
    });

    it("should propagate errors thrown by careerService.getMyCareer", async () => {
      mockCareerService.getMyCareer.mockRejectedValue(
        new Error("Service error"),
      );

      await expect(
        controller.getMyCareer(makeRequest("user-abc")),
      ).rejects.toThrow("Service error");
    });
  });

  // ---------------------------------------------------------------------------
  // GET /career/search-members
  // ---------------------------------------------------------------------------
  describe("searchMembers", () => {
    it("should call careerService.searchMembers with userId and the query string", async () => {
      mockCareerService.searchMembers.mockResolvedValue([]);
      const req = makeRequest("user-def");

      await controller.searchMembers(req, "Ali");

      expect(mockCareerService.searchMembers).toHaveBeenCalledWith(
        "user-def",
        "Ali",
      );
      expect(mockCareerService.searchMembers).toHaveBeenCalledTimes(1);
    });

    it("should pass an empty string to careerService when q is undefined", async () => {
      mockCareerService.searchMembers.mockResolvedValue([]);
      const req = makeRequest("user-def");

      await controller.searchMembers(req, undefined);

      expect(mockCareerService.searchMembers).toHaveBeenCalledWith(
        "user-def",
        "",
      );
    });

    it("should return the members list from careerService.searchMembers", async () => {
      const members: CareerSearchMember[] = [
        {
          id: "u1",
          firstName: "Alice",
          lastName: "Dupont",
          clubName: "Club A",
        },
      ];
      mockCareerService.searchMembers.mockResolvedValue(members);

      const result = await controller.searchMembers(
        makeRequest("user-def"),
        "Ali",
      );

      expect(result).toEqual(members);
    });

    it("should propagate errors thrown by careerService.searchMembers", async () => {
      mockCareerService.searchMembers.mockRejectedValue(
        new Error("Search failed"),
      );

      await expect(
        controller.searchMembers(makeRequest("user-def"), "Ali"),
      ).rejects.toThrow("Search failed");
    });
  });

  // ---------------------------------------------------------------------------
  // GET /career/user/:userId
  // ---------------------------------------------------------------------------
  describe("getCareerByUserId", () => {
    it("should call careerService.getCareerForUser with the route userId param", async () => {
      mockCareerService.getCareerForUser.mockResolvedValue(emptyCareer);

      await controller.getCareerByUserId("target-user-id");

      expect(mockCareerService.getCareerForUser).toHaveBeenCalledWith(
        "target-user-id",
      );
      expect(mockCareerService.getCareerForUser).toHaveBeenCalledTimes(1);
    });

    it("should return the career from careerService.getCareerForUser", async () => {
      mockCareerService.getCareerForUser.mockResolvedValue(emptyCareer);

      const result = await controller.getCareerByUserId("target-user-id");

      expect(result).toEqual(emptyCareer);
    });

    it("should propagate NotFoundException when careerService.getCareerForUser throws", async () => {
      const { NotFoundException } =
        require("@nestjs/common") as typeof import("@nestjs/common");
      mockCareerService.getCareerForUser.mockRejectedValue(
        new NotFoundException("Utilisateur non trouvé"),
      );

      await expect(controller.getCareerByUserId("unknown-id")).rejects.toThrow(
        "Utilisateur non trouvé",
      );
    });
  });
});
