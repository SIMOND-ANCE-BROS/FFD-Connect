import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import { ParentalConsentApi } from "../../../services/api/parental-consent-api";
import { useAuthStore } from "../../../stores/auth.store";
import {
  PARENTAL_CONSENT_FRESH_MS,
  parentalConsentQueryKey,
  useParentalConsent,
} from "../useParentalConsent";

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

jest.mock("../../../services/api/parental-consent-api", () => ({
  ParentalConsentApi: { getMine: jest.fn(), request: jest.fn() },
}));

const getMine = ParentalConsentApi.getMine as jest.Mock;
const request = ParentalConsentApi.request as jest.Mock;

let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

describe("useParentalConsent (#61)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    useAuthStore.setState({
      isLoggedIn: true,
      isGuest: false,
      impersonating: false,
      impersonatedName: null,
    });
  });

  it("scopes the cache to the account the session acts as", () => {
    expect(parentalConsentQueryKey(false, null)).toEqual([
      "parental-consent",
      "self",
    ]);
    expect(parentalConsentQueryKey(true, "Léa")).toEqual([
      "parental-consent",
      "impersonating:Léa",
    ]);
    expect(parentalConsentQueryKey(true, null)).toEqual([
      "parental-consent",
      "impersonating:",
    ]);
  });

  it("loads the state of a signed-in account", async () => {
    getMine.mockResolvedValue({ state: "REQUIRED" });
    const { result } = await renderHook(() => useParentalConsent(), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.consent).toEqual({ state: "REQUIRED" }),
    );
    expect(getMine).toHaveBeenCalledTimes(1);
  });

  it("reads nothing for a guest", async () => {
    useAuthStore.setState({ isGuest: true });
    const { result } = await renderHook(() => useParentalConsent(), {
      wrapper,
    });
    expect(result.current.consent).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(getMine).not.toHaveBeenCalled();
  });

  it("re-reads on focus only a stale PENDING state", async () => {
    getMine.mockResolvedValue({ state: "PENDING" });
    const { result } = await renderHook(() => useParentalConsent(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.consent?.state).toBe("PENDING"));

    // Fresh: no request.
    await act(async () => refocus());
    expect(getMine).toHaveBeenCalledTimes(1);

    // Stale: read again.
    const now = Date.now();
    const spy = jest
      .spyOn(Date, "now")
      .mockReturnValue(now + PARENTAL_CONSENT_FRESH_MS + 1);
    getMine.mockResolvedValue({ state: "GRANTED" });
    await act(async () => refocus());
    spy.mockRestore();
    await waitFor(() => expect(result.current.consent?.state).toBe("GRANTED"));

    // GRANTED: never re-read on focus.
    await act(async () => refocus());
    expect(getMine).toHaveBeenCalledTimes(2);
  });

  it("stores the state returned by a request", async () => {
    getMine.mockResolvedValue({ state: "REQUIRED" });
    request.mockResolvedValue({ state: "PENDING" });
    const { result } = await renderHook(() => useParentalConsent(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.consent?.state).toBe("REQUIRED"));

    await act(async () => {
      await result.current.request.mutateAsync("parent@example.fr");
    });

    expect(request).toHaveBeenCalledWith("parent@example.fr");
    await waitFor(() => expect(result.current.consent?.state).toBe("PENDING"));
  });
});
