import api from "../../../../services/api";
import { CheckinService } from "../CheckinService";

jest.mock("../../../../services/api", () => ({
  post: jest.fn(),
  get: jest.fn(),
}));

describe("CheckinService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("checks in user and returns response", async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { registrations: [] },
    });

    const result = await CheckinService.checkIn("comp-1", "qr-data");

    expect(api.post).toHaveBeenCalledWith("/competitions/comp-1/checkin", {
      qrData: "qr-data",
    });
    expect(result.registrations).toEqual([]);
  });

  it("returns active competition data", async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { id: "comp-1" } });
    const result = await CheckinService.getActiveCompetition();
    expect(result).toEqual({ id: "comp-1" });
  });

  it("returns null when active competition fetch fails", async () => {
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    (api.get as jest.Mock).mockRejectedValue(new Error("fail"));
    const result = await CheckinService.getActiveCompetition();
    expect(result).toBeNull();
    consoleSpy.mockRestore();
  });
});
