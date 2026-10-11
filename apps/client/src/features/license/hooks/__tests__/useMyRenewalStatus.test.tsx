import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import { mockAuthRepository } from "../../../../__tests__/mocks/mockAuthRepository";
import {
  MY_RENEWAL_STATUS_QUERY_KEY,
  setMyRenewalStatus,
  useRenewalUnderReview,
} from "../useMyRenewalStatus";

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
