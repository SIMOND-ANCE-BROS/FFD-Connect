import { ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Test, TestingModule } from "@nestjs/testing";
import { WdsfController } from "./wdsf.controller";
import { WdsfService } from "./wdsf.service";

describe("WdsfController", () => {
  let controller: WdsfController;

  const mockWdsfService = {
    getAthleteByMin: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WdsfController],
      providers: [{ provide: WdsfService, useValue: mockWdsfService }],
    })
      .overrideGuard(AuthGuard("jwt"))
      .useValue({
        canActivate: (_context: ExecutionContext) => true,
      })
      .compile();

    controller = module.get<WdsfController>(WdsfController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("getAthlete", () => {
    it("should call service.getAthleteByMin with min", async () => {
      const mockAthlete = {
        firstName: "John",
        lastName: "Doe",
        licenseNumber: "12345",
      };

      mockWdsfService.getAthleteByMin.mockResolvedValue(mockAthlete);

      const result = await controller.getAthlete("12345");

      expect(mockWdsfService["getAthleteByMin"]).toHaveBeenCalledWith("12345");
      expect(result).toEqual(mockAthlete);
    });
  });
});
