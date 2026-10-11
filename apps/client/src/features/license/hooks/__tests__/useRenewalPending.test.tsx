import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import { BackendService } from "../../../../services/BackendService";
import { useAuthStore } from "../../../../stores/auth.store";
import { renewalStatusQueryKey, useRenewalPending } from "../useRenewalPending";

const mockGetAuthConfig = jest.fn();
jest.mock("../../../auth/context/AuthContext", () => ({
  useAuthRepository: () => ({ getAuthConfig: mockGetAuthConfig }),
}));
jest.mock("../../../../services/BackendService", () => ({
  BackendService: { getMyRenewalRequest: jest.fn() },
}));

const mockGetMyRenewal = BackendService.getMyRenewalRequest as jest.Mock;

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

/** Waits until the status query has resolved or failed, not just started. */
const settled = () =>
  waitFor(() => {
    const queries = client.getQueryCache().getAll();
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) expect(q.state.status).not.toBe("pending");
  });

describe("useRenewalPending (#268)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    useAuthStore.setState({ impersonating: false, impersonatedName: null });
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

      await settled();
      expect(result.current).toBe(false);
    },
  );

  it("is false without a request", async () => {
    mockGetMyRenewal.mockResolvedValue(null);

    const { result } = await renderHook(() => useRenewalPending(), {
      wrapper,
    });

    await settled();
    expect(result.current).toBe(false);
  });

  it("asks nothing for a guest", async () => {
    mockGetAuthConfig.mockResolvedValue({ authToken: null, isLoggedIn: false });

    const { result } = await renderHook(() => useRenewalPending(), {
      wrapper,
    });

    await settled();
    expect(mockGetMyRenewal).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });

  it("is false when the status cannot be loaded", async () => {
    mockGetMyRenewal.mockRejectedValue(new Error("network"));

    const { result } = await renderHook(() => useRenewalPending(), {
      wrapper,
    });

    await settled();
    expect(result.current).toBe(false);
  });

  // An impersonation keeps the session (and the mounted tabs) alive: the
  // admin's own status must never stand for the impersonated account's.
  it("does not reuse the account's status during an impersonation", async () => {
    client.setQueryData(renewalStatusQueryKey(), "PENDING");
    useAuthStore.setState({ impersonating: true, impersonatedName: "Jo D." });
    mockGetMyRenewal.mockResolvedValue({ id: "r2", status: "DRAFT" });

    const { result } = await renderHook(() => useRenewalPending(), {
      wrapper,
    });

    await waitFor(() => expect(mockGetMyRenewal).toHaveBeenCalled());
    await settled();
    expect(result.current).toBe(false);
  });
});
