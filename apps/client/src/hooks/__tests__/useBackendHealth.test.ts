import { renderHook } from "@testing-library/react-native";
import { useBackendHealth } from "../useBackendHealth";
import { BackendService } from "../../services/BackendService";

jest.mock("../../services/BackendService", () => ({
  BackendService: {
    checkHealth: jest.fn(),
  },
}));

const mockBackend = BackendService as jest.Mocked<typeof BackendService>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useBackendHealth", () => {
  it("returns true when the backend is healthy", async () => {
    mockBackend.checkHealth.mockResolvedValue(true);

    const { result } = await renderHook(() => useBackendHealth());
    await expect(result.current.checkHealth()).resolves.toBe(true);
    expect(mockBackend.checkHealth).toHaveBeenCalledTimes(1);
  });

  it("returns false when the backend is unreachable", async () => {
    mockBackend.checkHealth.mockResolvedValue(false);

    const { result } = await renderHook(() => useBackendHealth());
    await expect(result.current.checkHealth()).resolves.toBe(false);
  });

  it("propagates errors from the service", async () => {
    mockBackend.checkHealth.mockRejectedValue(new Error("network down"));

    const { result } = await renderHook(() => useBackendHealth());
    await expect(result.current.checkHealth()).rejects.toThrow("network down");
  });

  it("returns a stable checkHealth reference across renders", async () => {
    const { result, rerender } = await renderHook(() => useBackendHealth());
    const first = result.current.checkHealth;

    await rerender({});

    expect(result.current.checkHealth).toBe(first);
  });
});
