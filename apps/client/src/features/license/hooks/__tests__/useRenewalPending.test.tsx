import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import { BackendService } from "../../../../services/BackendService";
import { useAuthStore } from "../../../../stores/auth.store";
import {
  refreshRenewalStatusIfPending,
  renewalStatusQueryKey,
  useRenewalPending,
} from "../useRenewalPending";

// Like the real useFocusEffect: runs at mount (first focus); `refocus`
// simulates the screen gaining focus again (Licence tab stays mounted).
let mockFocusCallback: (() => void) | null = null;
const refocus = () => mockFocusCallback?.();
jest.mock("@react-navigation/native", () => {
  const ReactActual = jest.requireActual<typeof React>("react");
  return {
    useFocusEffect: (callback: () => void) => {
      mockFocusCallback = callback;
      ReactActual.useEffect(() => callback(), [callback]);
    },
  };
});

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

  describe("on focus", () => {
    it("re-reads a PENDING status, so the banner drops once the decision is taken", async () => {
      mockGetMyRenewal.mockResolvedValue({ id: "r1", status: "PENDING" });
      const { result } = await renderHook(() => useRenewalPending(), {
        wrapper,
      });
      await waitFor(() => expect(result.current).toBe(true));
      expect(mockGetMyRenewal).toHaveBeenCalledTimes(1);

      mockGetMyRenewal.mockResolvedValue({ id: "r1", status: "APPROVED" });
      await act(async () => {
        refocus();
      });

      await waitFor(() => expect(result.current).toBe(false));
      expect(mockGetMyRenewal).toHaveBeenCalledTimes(2);
    });

    it.each([
      ["a DRAFT request", { id: "r1", status: "DRAFT" }],
      ["a decided request", { id: "r1", status: "APPROVED" }],
      ["no request", null],
    ])("sends no request for %s (scale-to-zero)", async (_label, request) => {
      mockGetMyRenewal.mockResolvedValue(request);
      await renderHook(() => useRenewalPending(), { wrapper });
      await settled();
      expect(mockGetMyRenewal).toHaveBeenCalledTimes(1);

      await act(async () => {
        refocus();
      });
      await settled();
      expect(mockGetMyRenewal).toHaveBeenCalledTimes(1);
    });

    it("joins the mount fetch instead of sending a second request", async () => {
      client.setQueryData(renewalStatusQueryKey(), "PENDING");
      mockGetMyRenewal.mockResolvedValue({ id: "r1", status: "PENDING" });

      await renderHook(() => useRenewalPending(), { wrapper });
      await settled();

      expect(mockGetMyRenewal).toHaveBeenCalledTimes(1);
    });
  });
});

describe("refreshRenewalStatusIfPending (#268)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
  });

  it("does nothing unless the cached status is PENDING", async () => {
    const refetch = jest.spyOn(client, "refetchQueries");
    const key = renewalStatusQueryKey(false, null);

    await refreshRenewalStatusIfPending(client, key);
    client.setQueryData(key, "REJECTED");
    await refreshRenewalStatusIfPending(client, key);
    expect(refetch).not.toHaveBeenCalled();

    client.setQueryData(key, "PENDING");
    await refreshRenewalStatusIfPending(client, key);
    expect(refetch).toHaveBeenCalledWith(
      { queryKey: key, exact: true },
      { cancelRefetch: false },
    );
  });
});
