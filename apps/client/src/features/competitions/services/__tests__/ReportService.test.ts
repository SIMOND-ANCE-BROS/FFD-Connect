import axios from "axios";
import { AuthService } from "../../../auth/services/AuthService";
import { ReportService } from "../ReportService";

const mockAppend = jest.fn();
(global as unknown as { FormData: unknown }).FormData = jest
  .fn()
  .mockImplementation(() => ({
    append: mockAppend,
  }));

jest.mock("axios", () => {
  return {
    create: jest.fn().mockReturnThis(),
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
    post: jest.fn(),
    get: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  };
});
jest.mock("../../../auth/services/AuthService");
jest.mock("../../../../utils/logger", () => ({
  createLogger: jest.fn().mockReturnValue({
    getLogs: jest.fn().mockReturnValue("mock logs"),
    info: jest.fn(),
    error: jest.fn(),
  }),
}));

describe("ReportService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should send a bug report successfully", async () => {
    const mockData: Parameters<typeof ReportService.sendReport>[0] = {
      type: "BUG",
      title: "Test Bug",
      description: "Test Description",
      module: "Test Module",
      severity: "HIGH",
    };

    (AuthService.getAuthConfig as jest.Mock).mockResolvedValue({
      isLoggedIn: true,
      username: "testUser",
    });

    (axios.post as jest.Mock).mockResolvedValue({ data: { success: true } });

    await ReportService.sendReport(mockData);

    expect(AuthService.getAuthConfig).toHaveBeenCalled();
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining("/reports"),
      expect.anything(),
      expect.objectContaining({
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }),
    );
  });

  it("should send an anonymous report if not logged in", async () => {
    const mockData = {
      type: "FEATURE" as const,
      title: "Test Feature",
      description: "Test Description",
    };

    (AuthService.getAuthConfig as jest.Mock).mockResolvedValue({
      isLoggedIn: false,
    });

    (axios.post as jest.Mock).mockResolvedValue({ data: { success: true } });

    await ReportService.sendReport(mockData);

    expect(mockAppend).toHaveBeenCalledWith("userId", "Anonymous");
  });

  it("should handle errors when sending report", async () => {
    const mockData = {
      type: "BUG" as const,
      title: "Fail Bug",
      description: "Fail Description",
    };

    (AuthService.getAuthConfig as jest.Mock).mockResolvedValue({
      isLoggedIn: true,
      username: "testUser",
    });

    (axios.post as jest.Mock).mockRejectedValue(new Error("Network Error"));

    await ReportService.sendReport(mockData);

    // Should not throw, but handle error
    expect(axios.post).toHaveBeenCalled();
  });

  it("should include image data in FormData when provided", async () => {
    const mockData = {
      type: "BUG" as const,
      title: "Test Bug with Image",
      description: "Test Description",
      image: { uri: "file://test.jpg", type: "image/jpeg", name: "test.jpg" },
    };

    (AuthService.getAuthConfig as jest.Mock).mockResolvedValue({
      isLoggedIn: true,
      username: "testUser",
    });

    (axios.post as jest.Mock).mockResolvedValue({ data: { success: true } });

    await ReportService.sendReport(mockData);

    expect(mockAppend).toHaveBeenCalledWith("image", {
      uri: "file://test.jpg",
      type: "image/jpeg",
      name: "test.jpg",
    });
  });
});
