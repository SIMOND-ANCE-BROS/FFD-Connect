import { renderHook, waitFor } from "@testing-library/react-native";
import {
  EntryQrApi,
  EntryQrNetworkError,
} from "../../../../services/api/entry-qr-api";
import { useAuthRepository } from "../../../auth/context/AuthContext";
import type { EntryQrBatch } from "../../utils/entryQr";
import {
  clearEntryQrBatch,
  loadEntryQrBatch,
  saveEntryQrBatch,
} from "../../utils/entryQrStorage";
import { useEntryQrBatch } from "../useEntryQrBatch";

jest.mock("@react-navigation/native", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) =>
      useEffect(effect, [effect]),
  };
});
jest.mock("../../../auth/context/AuthContext", () => ({
  useAuthRepository: jest.fn(),
}));
jest.mock("../../../../services/api/entry-qr-api", () => {
  class EntryQrNetworkError extends Error {}
  return { EntryQrApi: { getMyBatch: jest.fn() }, EntryQrNetworkError };
});
jest.mock("../../utils/entryQrStorage", () => ({
  loadEntryQrBatch: jest.fn(),
  saveEntryQrBatch: jest.fn(),
  clearEntryQrBatch: jest.fn(),
}));

const batch = (hoursLeft: number): EntryQrBatch => ({
  version: 3,
  keyId: "k",
  licenseId: "lic-1",
  number: "FFD-1",
  holderName: "DUPONT Jean",
  stepSeconds: 30,
  toleranceSteps: 1,
  firstStep: 1,
  signatures: [],
  coversUntil: new Date(Date.now() + hoursLeft * 3600_000).toISOString(),
});

const getAuthConfig = jest.fn();
const getMyBatch = EntryQrApi.getMyBatch as jest.Mock;
const loadBatch = loadEntryQrBatch as jest.Mock;

describe("useEntryQrBatch (#24)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthRepository as jest.Mock).mockReturnValue({ getAuthConfig });
    getAuthConfig.mockResolvedValue({
      isLoggedIn: true,
      username: "jean@example.com",
    });
    loadBatch.mockResolvedValue(null);
  });

  it("does nothing when disabled", async () => {
    const { result } = await renderHook(() => useEntryQrBatch(false));
    expect(result.current).toBeNull();
    expect(getAuthConfig).not.toHaveBeenCalled();
  });

  it("serves a cached batch that still covers 6 h without calling the API", async () => {
    const cached = batch(10);
    loadBatch.mockResolvedValue(cached);
    const { result } = await renderHook(() => useEntryQrBatch(true));
    await waitFor(() => expect(result.current).toBe(cached));
    expect(loadBatch).toHaveBeenCalledWith("jean@example.com");
    expect(getMyBatch).not.toHaveBeenCalled();
  });

  it("refreshes a short batch and stores the new one for this account", async () => {
    loadBatch.mockResolvedValue(batch(1));
    const fresh = batch(12);
    getMyBatch.mockResolvedValue({ kind: "batch", batch: fresh });
    const { result } = await renderHook(() => useEntryQrBatch(true));
    await waitFor(() => expect(result.current).toBe(fresh));
    expect(saveEntryQrBatch).toHaveBeenCalledWith("jean@example.com", fresh);
  });

  it("drops the cache when the server has no batch for the account", async () => {
    loadBatch.mockResolvedValue(batch(1));
    getMyBatch.mockResolvedValue({ kind: "unavailable", status: 404 });
    const { result } = await renderHook(() => useEntryQrBatch(true));
    await waitFor(() => expect(clearEntryQrBatch).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("keeps the cached batch offline", async () => {
    const cached = batch(1);
    loadBatch.mockResolvedValue(cached);
    getMyBatch.mockRejectedValue(new EntryQrNetworkError());
    const { result } = await renderHook(() => useEntryQrBatch(true));
    await waitFor(() => expect(getMyBatch).toHaveBeenCalled());
    expect(result.current).toBe(cached);
    expect(clearEntryQrBatch).not.toHaveBeenCalled();
  });

  it("swallows unexpected errors", async () => {
    getMyBatch.mockRejectedValue(new Error("boom"));
    const { result } = await renderHook(() => useEntryQrBatch(true));
    await waitFor(() => expect(getMyBatch).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it.each([
    { isLoggedIn: false },
    { isLoggedIn: true, isGuest: true },
    { isLoggedIn: true, impersonating: true, username: "x" },
  ])("never fetches for %p", async (config) => {
    getAuthConfig.mockResolvedValue(config);
    await renderHook(() => useEntryQrBatch(true));
    await waitFor(() => expect(getAuthConfig).toHaveBeenCalled());
    expect(loadBatch).not.toHaveBeenCalled();
    expect(getMyBatch).not.toHaveBeenCalled();
  });
});
