import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react-native";
import React from "react";
import { TrackApi } from "../../../../services/api/track-api";
import { useLibrarySyncStore } from "../../../../stores/librarySync.store";
import { useBlacklistTrack } from "../useBlacklistTrack";

jest.mock("../../../../services/api/track-api", () => ({
  TrackApi: { blacklistTrack: jest.fn() },
}));

const setup = async () => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidate = jest.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  const hook = await renderHook(() => useBlacklistTrack(), { wrapper });
  return { ...hook, invalidate };
};

describe("useBlacklistTrack (#561)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("blacklists, marks the library stale and refreshes the moderation queue", async () => {
    (TrackApi.blacklistTrack as jest.Mock).mockResolvedValue(undefined);
    const before = useLibrarySyncStore.getState().version;
    const { result, invalidate } = await setup();

    await act(async () => {
      await result.current.mutateAsync("t1");
    });

    expect(TrackApi.blacklistTrack).toHaveBeenCalledWith("t1");
    expect(useLibrarySyncStore.getState().version).toBe(before + 1);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["track-corrections"],
    });
  });

  it("leaves the library untouched when the server refuses", async () => {
    (TrackApi.blacklistTrack as jest.Mock).mockRejectedValue(
      new Error("Seul un administrateur peut blacklister un titre."),
    );
    const before = useLibrarySyncStore.getState().version;
    const { result, invalidate } = await setup();

    await act(async () => {
      await expect(result.current.mutateAsync("t1")).rejects.toThrow(
        "Seul un administrateur",
      );
    });

    expect(useLibrarySyncStore.getState().version).toBe(before);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
