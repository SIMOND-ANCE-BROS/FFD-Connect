import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFocusEffect } from "@react-navigation/native";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import React, { PropsWithChildren } from "react";
import { usersControllerGetMembers } from "../../../../api/generated/sdk.gen";
import { useAuthStore } from "../../../../stores/auth.store";
import {
  clubMembersCountQueryKey,
  fetchClubMembersCount,
  useClubMembersCount,
} from "../useClubMembersCount";

jest.mock("@react-navigation/native", () => ({
  useFocusEffect: jest.fn(),
}));
jest.mock("../../../../api/client", () => ({}));
jest.mock("../../../../api/generated/sdk.gen", () => ({
  usersControllerGetMembers: jest.fn(),
}));

const membersMock = usersControllerGetMembers as jest.Mock;
const focusEffectMock = useFocusEffect as jest.Mock;

const page = (total: number) => ({
  data: {
    data: [],
    meta: { total, skip: 0, take: 1, hasMore: total > 1 },
  },
});

const wrapper = ({ children }: PropsWithChildren) => {
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe("fetchClubMembersCount", () => {
  beforeEach(() => membersMock.mockReset());

  it("reads the club's total from a one-row page", async () => {
    membersMock.mockResolvedValue(page(42));
    await expect(fetchClubMembersCount()).resolves.toBe(42);
    // The total, not the length of a (capped) page.
    expect(membersMock).toHaveBeenCalledWith({ query: { take: 1 } });
  });

  it("returns a real zero when the club has no member", async () => {
    membersMock.mockResolvedValue(page(0));
    await expect(fetchClubMembersCount()).resolves.toBe(0);
  });

  it("throws instead of inventing a count when the API fails", async () => {
    membersMock.mockResolvedValue({ error: { message: "boom" } });
    await expect(fetchClubMembersCount()).rejects.toThrow();
  });

  it.each([
    ["no payload", undefined],
    ["a bare list", [{ id: "m1" }]],
    ["no meta", { data: [] }],
    ["a non-numeric total", { data: [], meta: { total: "3" } }],
    ["a negative total", { data: [], meta: { total: -1 } }],
  ])("throws when the payload has %s", async (_label, data) => {
    membersMock.mockResolvedValue({ data });
    await expect(fetchClubMembersCount()).rejects.toThrow();
  });
});

describe("clubMembersCountQueryKey", () => {
  it("scopes the cache to the impersonated club", () => {
    expect(clubMembersCountQueryKey(false, null)).toEqual([
      "club-members-count",
      "self",
    ]);
    expect(clubMembersCountQueryKey(true, "Club A")).toEqual([
      "club-members-count",
      "impersonating:Club A",
    ]);
  });
});

describe("useClubMembersCount", () => {
  beforeEach(() => {
    membersMock.mockReset();
    focusEffectMock.mockReset();
    useAuthStore.setState({ impersonating: false, impersonatedName: null });
  });

  it("loads the count", async () => {
    membersMock.mockResolvedValue(page(3));
    const { result } = await renderHook(() => useClubMembersCount(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toBe(3));
  });

  it("stays unknown when the request fails", async () => {
    membersMock.mockResolvedValue({ error: { message: "boom" } });
    // React Query's default retry policy, so only the hook's own option
    // keeps a failed request from being replayed.
    const retryingWrapper = ({ children }: PropsWithChildren) => {
      const [client] = React.useState(
        () =>
          new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } }),
      );
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    };
    const { result } = await renderHook(() => useClubMembersCount(), {
      wrapper: retryingWrapper,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    // No ad hoc retry: waking the backend is handled globally.
    expect(membersMock).toHaveBeenCalledTimes(1);
  });

  it("reloads the count when the screen comes back into focus", async () => {
    let focusCallback: (() => void) | undefined;
    focusEffectMock.mockImplementation((cb: () => void) => {
      focusCallback = cb;
    });
    membersMock.mockResolvedValueOnce(page(2));
    membersMock.mockResolvedValueOnce(page(5));

    const { result } = await renderHook(() => useClubMembersCount(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toBe(2));

    // First focus = mount: the initial query already ran, no second call.
    await act(async () => focusCallback?.());
    expect(membersMock).toHaveBeenCalledTimes(1);

    // Coming back (after adding members) reloads the real count.
    await act(async () => focusCallback?.());
    await waitFor(() => expect(result.current.data).toBe(5));
    expect(membersMock).toHaveBeenCalledTimes(2);
  });
});
