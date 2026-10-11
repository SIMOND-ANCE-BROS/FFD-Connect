import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import { mockAuthRepository } from "../../../../__tests__/mocks/mockAuthRepository";
import {
  MY_RENEWAL_STATUS_QUERY_KEY,
  setMyRenewalStatus,
  useRenewalStatusRefresh,
  useRenewalUnderReview,
} from "../useMyRenewalStatus";

// Like the real useFocusEffect: runs at mount (first focus); `mockFocus`
// simulates the screen gaining focus again.
let mockFocusCallback: (() => void) | null = null;
const mockFocus = () => mockFocusCallback?.();
jest.mock("@react-navigation/native", () => {
  const ReactActual = require("react");
  return {
    useFocusEffect: (callback: () => void) => {
      mockFocusCallback = callback;
      ReactActual.useEffect(() => callback(), [callback]);
    },
  };
});

jest.mock("../../../auth/context/AuthContext", () => ({
  useAuthRepository: () => mockAuthRepository,
}));

jest.mock("../../../../services/api/license-api", () => ({
  LicenseApi: { getMyRenewalRequest: jest.fn() },
}));

import { LicenseApi } from "../../../../services/api/license-api";

const mockGetMyRenewal = LicenseApi.getMyRenewalRequest as jest.Mock;

const makeClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const wrapperFor =
  (client: QueryClient) =>
  ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);

const request = (status: string) => ({
  id: "req-1",
  userId: "user-1",
  status,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  submittedAt: null,
  reviewedAt: null,
  rejectionReason: "MEDICAL_RESTRICTION",
  reviewComment: "Commentaire",
  documents: [
    {
      id: "doc-1",
      requestId: "req-1",
      type: "MEDICAL_CERTIFICATE",
      filePath: "x",
      ocrData: { isApte: false },
      createdAt: "2026-10-01T00:00:00Z",
    },
  ],
});

describe("useRenewalUnderReview (#268)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      authToken: "token",
      isLoggedIn: true,
    });
  });

  it("is true while the latest request is PENDING", async () => {
    mockGetMyRenewal.mockResolvedValue(request("PENDING"));
    const { result } = await renderHook(() => useRenewalUnderReview(), {
      wrapper: wrapperFor(makeClient()),
    });
    await waitFor(() => expect(result.current).toBe(true));
    expect(mockGetMyRenewal).toHaveBeenCalledWith("token");
  });

  it.each(["DRAFT", "APPROVED", "REJECTED"])(
    "is false for a %s request",
    async (status) => {
      mockGetMyRenewal.mockResolvedValue(request(status));
      const client = makeClient();
      const { result } = await renderHook(() => useRenewalUnderReview(), {
        wrapper: wrapperFor(client),
      });
      await waitFor(() =>
        expect(client.getQueryData(MY_RENEWAL_STATUS_QUERY_KEY)).toBeTruthy(),
      );
      expect(result.current).toBe(false);
    },
  );

  it("caches the status only — no document, OCR reading nor review outcome", async () => {
    mockGetMyRenewal.mockResolvedValue(request("PENDING"));
    const client = makeClient();
    await renderHook(() => useRenewalUnderReview(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() =>
      expect(client.getQueryData(MY_RENEWAL_STATUS_QUERY_KEY)).toEqual({
        id: "req-1",
        status: "PENDING",
      }),
    );
  });

  it("does not call the API for a signed-out user", async () => {
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      authToken: null,
      isLoggedIn: false,
    });
    const client = makeClient();
    const { result } = await renderHook(() => useRenewalUnderReview(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() =>
      expect(client.getQueryState(MY_RENEWAL_STATUS_QUERY_KEY)?.status).toBe(
        "success",
      ),
    );
    expect(mockGetMyRenewal).not.toHaveBeenCalled();
    expect(result.current).toBe(false);
  });

  it("does nothing when disabled (guest)", async () => {
    const client = makeClient();
    client.setQueryData(MY_RENEWAL_STATUS_QUERY_KEY, {
      id: "req-1",
      status: "PENDING",
    });
    const { result } = await renderHook(() => useRenewalUnderReview(false), {
      wrapper: wrapperFor(client),
    });
    expect(result.current).toBe(false);
    expect(mockGetMyRenewal).not.toHaveBeenCalled();
  });

  it("stays false when the request fails", async () => {
    mockGetMyRenewal.mockRejectedValue(new Error("boom"));
    const client = makeClient();
    const { result } = await renderHook(() => useRenewalUnderReview(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() =>
      expect(client.getQueryState(MY_RENEWAL_STATUS_QUERY_KEY)?.status).toBe(
        "error",
      ),
    );
    expect(result.current).toBe(false);
  });

  it("follows the status pushed by the renewal screen", async () => {
    mockGetMyRenewal.mockResolvedValue(request("DRAFT"));
    const client = makeClient();
    const { result } = await renderHook(() => useRenewalUnderReview(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() =>
      expect(client.getQueryData(MY_RENEWAL_STATUS_QUERY_KEY)).toBeTruthy(),
    );
    expect(result.current).toBe(false);

    await act(async () => {
      setMyRenewalStatus(client, request("PENDING") as never);
    });
    expect(result.current).toBe(true);

    await act(async () => {
      setMyRenewalStatus(client, null);
    });
    expect(result.current).toBe(false);
  });
});

describe("useRenewalStatusRefresh (#268)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFocusCallback = null;
    mockAuthRepository.getAuthConfig.mockResolvedValue({
      authToken: "token",
      isLoggedIn: true,
    });
  });

  const useBannerState = (enabled = true) => {
    useRenewalStatusRefresh(enabled);
    return useRenewalUnderReview(enabled);
  };

  it("drops the banner once the decision is taken, at the next focus", async () => {
    mockGetMyRenewal.mockResolvedValue(request("PENDING"));
    const client = makeClient();
    const { result } = await renderHook(() => useBannerState(), {
      wrapper: wrapperFor(client),
    });
    await waitFor(() => expect(result.current).toBe(true));
    // The first focus joins the mount fetch instead of firing a second one.
    expect(mockGetMyRenewal).toHaveBeenCalledTimes(1);

    // The administrator approves while the Licence tab stays mounted.
    mockGetMyRenewal.mockResolvedValue(request("APPROVED"));
    await act(async () => {
      mockFocus();
    });

    await waitFor(() => expect(result.current).toBe(false));
    expect(mockGetMyRenewal).toHaveBeenCalledTimes(2);
  });

  it("returns a callback that re-reads the status (pull-to-refresh)", async () => {
    mockGetMyRenewal.mockResolvedValue(request("PENDING"));
    const client = makeClient();
    const { result } = await renderHook(
      () => ({
        refresh: useRenewalStatusRefresh(),
        underReview: useRenewalUnderReview(),
      }),
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => expect(result.current.underReview).toBe(true));

    mockGetMyRenewal.mockResolvedValue(request("REJECTED"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.underReview).toBe(false);
  });

  it("does not fetch when disabled (guest)", async () => {
    const client = makeClient();
    await renderHook(() => useBannerState(false), {
      wrapper: wrapperFor(client),
    });
    await act(async () => {
      mockFocus();
    });
    expect(mockGetMyRenewal).not.toHaveBeenCalled();
  });
});
