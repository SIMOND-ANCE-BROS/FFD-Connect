import { Test, TestingModule } from "@nestjs/testing";
import { SeatOccupancyController } from "./seat-occupancy.controller";
import { SeatOccupancyQueryService } from "./seat-occupancy-query.service";

describe("SeatOccupancyController", () => {
  let controller: SeatOccupancyController;
  const getOccupancy = jest.fn();

  beforeEach(async () => {
    getOccupancy.mockReset().mockResolvedValue({
      competitionId: "comp-1",
      elements: [],
    });
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SeatOccupancyController],
      providers: [
        { provide: SeatOccupancyQueryService, useValue: { getOccupancy } },
      ],
    }).compile();
    controller = module.get(SeatOccupancyController);
  });

  it("serves an anonymous caller", async () => {
    await expect(controller.getSeatOccupancy("comp-1", {})).resolves.toEqual({
      competitionId: "comp-1",
      elements: [],
    });
    expect(getOccupancy).toHaveBeenCalledWith("comp-1", undefined);
  });

  it("passes the authenticated caller to flag their own seats", async () => {
    await controller.getSeatOccupancy("comp-1", { user: { userId: "u-1" } });
    expect(getOccupancy).toHaveBeenCalledWith("comp-1", "u-1");
  });
});
