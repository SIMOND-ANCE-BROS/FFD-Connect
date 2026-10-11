import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import { BackendService } from "../../../../services/BackendService";
import { useRenewalPending } from "../useRenewalPending";

const mockGetAuthConfig = jest.fn();
jest.mock("../../../auth/context/AuthContext", () => ({
  useAuthRepository: () => ({ getAuthConfig: mockGetAuthConfig }),
}));
jest.mock("../../../../services/BackendService", () => ({
  BackendService: { getMyRenewalRequest: jest.fn() },
}));

const mockGetMyRenewal = BackendService.getMyRenewalRequest as jest.Mock;

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe("useRenewalPending (#268)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthConfig.mockResolvedValue({
      authToken: "token-abc",
      isLoggedIn: true,
    });
  });

  it("is true while the licensee's request awaits a decision", async () => {
    mockGetMyRenewal.mockResolvedValue({ id: "r1", status: "PENDING" });

    const { result } = await renderHook(() => useRenewalPending(), {
      wrapper,
    });

    await waitFor(() => expect(result.current).toBe(true));
    expect(mockGetMyRenewal).toHaveBeenCalledWith("token-abc");
  });

  it.each(["DRAFT", "APPROVED", "REJECTED"])(
    "is false for a %s request",
    async (status) => {
      mockGetMyRenewal.mockResolvedValue({ id: "r1", status });

      const { result } = await renderHook(() => useRenewalPending(), {
        wrapper,
      });

      await waitFor(() => expect(mockGetMyRenewal).toHaveBeenCalled());
      expect(result.current).toBe(false);
    },
  );

  it("is false without a request", async () => {
    mockGetMyRenewal.mockResolvedValue(null);

    const { result } = await renderHook(() => useRenewalPending(), {
      wrapper,
    });

    await waitFor(() => expect(mockGetMyRenewal).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("asks nothing for a guest", async () => {
    mockGetAuthConfig.mockResolvedValue({ authToken: null, isLoggedIn: false });

    const { result } = await renderHook(() => useRenewalPending(), {
      wrapper,
    });

    await waitFor(() => expect(mockGetAuthConfig).toHaveBeenCalled());
    expect(mockGetMyRenewal).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });

  it("is false when the status cannot be loaded", async () => {
    mockGetMyRenewal.mockRejectedValue(new Error("network"));

    const { result } = await renderHook(() => useRenewalPending(), {
      wrapper,
    });

    await waitFor(() => expect(mockGetMyRenewal).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });
});
