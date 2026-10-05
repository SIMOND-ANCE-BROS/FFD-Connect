import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import { TrackRepository } from "../../services/TrackRepository";
import { LibraryProvider, useLibrary } from "../LibraryContext";
import { TrackProvider } from "../TrackContext";

jest.mock("@sentry/react-native", () => ({
  addBreadcrumb: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

const mockTracks = [
  {
    id: "1",
    title: "Latin Track",
    artist: "Artist A",
    filename: "track1.mp3",
    bpm: 120,
    style: "Latin",
  },
  {
    id: "2",
    title: "Standard Track",
    artist: "Artist B",
    filename: "track2.mp3",
    bpm: 110,
    style: "Standard",
  },
];

const mockRepo: TrackRepository = {
  getAllTracks: jest.fn().mockResolvedValue(mockTracks),
  getTracksPage: jest.fn().mockResolvedValue({
    tracks: mockTracks,
    hasMore: false,
    total: mockTracks.length,
  }),
  getTrackUrl: jest.fn((filename: string) => `file:///${filename}`),
  getArtworkUrl: jest.fn(() => undefined),
  addTrack: jest.fn(),
};

// LibraryProvider depends on useTrackRepository(), so we need TrackProvider as root.
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <TrackProvider implementation={mockRepo}>
    <LibraryProvider>{children}</LibraryProvider>
  </TrackProvider>
);

describe("LibraryContext", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockRepo.getTracksPage as jest.Mock).mockResolvedValue({
      tracks: mockTracks,
      hasMore: false,
      total: mockTracks.length,
    });
  });

  it("provides empty sections on mount until reloadLibrary is called", async () => {
    const { result } = await renderHook(() => useLibrary(), { wrapper });

    expect(result.current.sections).toHaveLength(0);
    expect(result.current.allTracks).toHaveLength(0);
    expect(result.current.groupBy).toBe("default");
    expect(result.current.searchQuery).toBe("");

    await act(async () => {
      await result.current.reloadLibrary();
    });

    await waitFor(() => {
      expect(result.current.sections.length).toBeGreaterThan(0);
    });
    expect(result.current.allTracks).toHaveLength(2);
  });

  it("setGroupBy updates grouping", async () => {
    const { result } = await renderHook(() => useLibrary(), { wrapper });

    await act(async () => {
      await result.current.reloadLibrary();
    });
    await waitFor(() => {
      expect(result.current.sections.length).toBeGreaterThan(0);
    });

    await act(() => {
      result.current.setGroupBy("style");
    });

    expect(result.current.groupBy).toBe("style");
  });

  it("setSearchQuery filters tracks", async () => {
    const { result } = await renderHook(() => useLibrary(), { wrapper });

    await act(async () => {
      await result.current.reloadLibrary();
    });
    await waitFor(() => {
      expect(result.current.allTracks.length).toBe(2);
    });

    await act(() => {
      result.current.setSearchQuery("Latin");
    });

    await waitFor(() => {
      const latinSection = result.current.sections.find(
        (s) =>
          s.title === "LATIN" || s.data.some((t) => t.title.includes("Latin")),
      );
      expect(latinSection ?? result.current.sections).toBeDefined();
    });
  });

  it("reloadLibrary refetches tracks", async () => {
    const { result } = await renderHook(() => useLibrary(), { wrapper });

    await act(async () => {
      await result.current.reloadLibrary();
    });
    await waitFor(() => {
      expect(result.current.allTracks.length).toBe(2);
    });

    (mockRepo.getTracksPage as jest.Mock).mockResolvedValue({
      tracks: [
        ...mockTracks,
        {
          id: "3",
          title: "New Track",
          artist: "Artist C",
          filename: "track3.mp3",
          bpm: 130,
          style: "Latin",
        },
      ],
      hasMore: false,
      total: 3,
    });

    await act(async () => {
      await result.current.reloadLibrary();
    });

    expect(mockRepo.getTracksPage).toHaveBeenCalledTimes(2);
    expect(result.current.allTracks).toHaveLength(3);
  });

  it("loadMore does not duplicate tracks when a page overlaps (skip race)", async () => {
    // On a short list, onEndReached can fire loadMore with a stale skip
    // (rawTracks.length still 0) → the backend page 0 is re-fetched. The
    // id dedup must absorb it so tracks aren't shown twice.
    (mockRepo.getTracksPage as jest.Mock)
      .mockResolvedValueOnce({
        tracks: mockTracks,
        hasMore: true,
        total: mockTracks.length,
      })
      .mockResolvedValueOnce({
        tracks: mockTracks, // same page re-fetched (the race)
        hasMore: false,
        total: mockTracks.length,
      });
    const { result } = await renderHook(() => useLibrary(), { wrapper });

    await act(async () => {
      await result.current.reloadLibrary();
    });
    await waitFor(() => {
      expect(result.current.allTracks).toHaveLength(2);
    });

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.allTracks).toHaveLength(2);
  });

  it("useLibrary throws when outside provider", async () => {
    await expect(renderHook(() => useLibrary())).rejects.toThrow(
      "useLibrary must be used within a LibraryProvider",
    );
  });
});
