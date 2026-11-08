import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFocusEffect } from "@react-navigation/native";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import { competitionsControllerGetClubPendingRegistrations } from "../../../../api/generated/sdk.gen";
import { useAuthStore } from "../../../../stores/auth.store";
import {
  clubPendingRegistrationsCountQueryKey,
  fetchClubPendingRegistrationsCount,
  useClubPendingRegistrationsCount,
} from "../useClubPendingRegistrationsCount";

jest.mock("@react-navigation/native", () => ({
  useFocusEffect: jest.fn(),
}));
jest.mock("../../../../api/client", () => ({}));
jest.mock("../../../../api/generated/sdk.gen", () => ({
  competitionsControllerGetClubPendingRegistrations: jest.fn(),
}));

const pendingMock =
  competitionsControllerGetClubPendingRegistrations as jest.Mock;

const focusEffectMock = useFocusEffect as jest.Mock;

const wrapper = ({ children }: PropsWithChildren) => {
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe("fetchClubPendingRegistrationsCount", () => {
  beforeEach(() => pendingMock.mockReset());

  it("counts the pending registrations returned by the API", async () => {
    pendingMock.mockResolvedValue({ data: [{ id: "r1" }, { id: "r2" }] });
    await expect(fetchClubPendingRegistrationsCount()).resolves.toBe(2);
  });

  it("returns a real zero for an empty list", async () => {
    pendingMock.mockResolvedValue({ data: [] });
    await expect(fetchClubPendingRegistrationsCount()).resolves.toBe(0);
  });

  it("throws instead of inventing a count when the API fails", async () => {
    pendingMock.mockResolvedValue({ error: { message: "boom" } });
    await expect(fetchClubPendingRegistrationsCount()).rejects.toThrow();
  });

  it("throws when the payload is not a list", async () => {
    pendingMock.mockResolvedValue({ data: { unexpected: true } });
    await expect(fetchClubPendingRegistrationsCount()).rejects.toThrow();
  });
});

describe("clubPendingRegistrationsCountQueryKey", () => {
  it("scopes the cache to the impersonated club", () => {
    expect(clubPendingRegistrationsCountQueryKey(false, null)).toEqual([
      "club-pending-registrations-count",
      "self",
    ]);
    expect(clubPendingRegistrationsCountQueryKey(true, "Club A")).toEqual([
      "club-pending-registrations-count",
      "impersonating:Club A",
    ]);
  });
});

describe("useClubPendingRegistrationsCount", () => {
  beforeEach(() => {
    pendingMock.mockReset();
    focusEffectMock.mockReset();
    useAuthStore.setState({ impersonating: false, impersonatedName: null });
  });

  it("loads the count when enabled", async () => {
    pendingMock.mockResolvedValue({ data: [{ id: "r1" }] });
    const { result } = await renderHook(
      () => useClubPendingRegistrationsCount(true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(1));
  });

  it("does not call the API while disabled", async () => {
    const { result } = await renderHook(
      () => useClubPendingRegistrationsCount(false),
      { wrapper },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.data).toBeUndefined();
    expect(pendingMock).not.toHaveBeenCalled();
  });

  it("reloads the count when the screen comes back into focus", async () => {
    let focusCallback: (() => void) | undefined;
    focusEffectMock.mockImplementation((cb: () => void) => {
      focusCallback = cb;
    });
    pendingMock.mockResolvedValueOnce({ data: [{ id: "r1" }, { id: "r2" }] });
    pendingMock.mockResolvedValueOnce({ data: [{ id: "r1" }] });

    const { result } = await renderHook(
      () => useClubPendingRegistrationsCount(true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBe(2));

    // First focus = mount: the initial query already ran, no second call.
    await act(async () => focusCallback?.());
    expect(pendingMock).toHaveBeenCalledTimes(1);

    // Coming back (after validating requests) reloads the real count.
    await act(async () => focusCallback?.());
    await waitFor(() => expect(result.current.data).toBe(1));
    expect(pendingMock).toHaveBeenCalledTimes(2);
  });
});
