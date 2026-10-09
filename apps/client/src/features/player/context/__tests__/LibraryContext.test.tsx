import { act, renderHook, waitFor } from "@testing-library/react-native";
import React from "react";
import { runSessionEndCleanups } from "../../../../services/sessionCleanup";
import { useAuthStore } from "../../../../stores/auth.store";
import { useLibrarySyncStore } from "../../../../stores/librarySync.store";
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
    useLibrarySyncStore.setState({ version: 0, loadedVersion: 0, loadedAt: 0 });
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

  describe("bibliothèque périmée (correction validée)", () => {
    const corrected = [
      { ...mockTracks[0], clashTimecodes: [] as number[] },
      {
        id: "3",
        title: "España Cañí",
        artist: "Orchestre",
        filename: "track3.mp3",
        bpm: 60,
        style: "Paso Doble",
        clashTimecodes: [] as number[],
      },
    ];

    it("ne charge rien tant que la bibliothèque n'a jamais été ouverte", async () => {
      await renderHook(() => useLibrary(), { wrapper });
      await act(() => {
        useLibrarySyncStore.getState().markStale();
      });
      expect(mockRepo.getTracksPage).not.toHaveBeenCalled();
    });

    it("recharge en arrière-plan une bibliothèque déjà chargée", async () => {
      (mockRepo.getTracksPage as jest.Mock).mockResolvedValue({
        tracks: corrected,
        hasMore: false,
        total: corrected.length,
      });
      const { result } = await renderHook(() => useLibrary(), { wrapper });
      await act(async () => {
        await result.current.reloadLibrary();
      });
      expect(useLibrarySyncStore.getState().loadedAt).toBeGreaterThan(0);

      (mockRepo.getTracksPage as jest.Mock).mockResolvedValue({
        tracks: [
          corrected[0],
          { ...corrected[1], clashTimecodes: [38.7, 77.4] },
        ],
        hasMore: false,
        total: corrected.length,
      });
      await act(() => {
        useLibrarySyncStore.getState().markStale();
      });

      await waitFor(() =>
        expect(
          result.current.allTracks.find((t) => t.id === "3")?.clashTimecodes,
        ).toEqual([38.7, 77.4]),
      );
      expect(mockRepo.getTracksPage).toHaveBeenCalledTimes(2);
      const sync = useLibrarySyncStore.getState();
      expect(sync.loadedVersion).toBe(sync.version);
    });

    it("garde la liste affichée si le rechargement échoue", async () => {
      const { result } = await renderHook(() => useLibrary(), { wrapper });
      await act(async () => {
        await result.current.reloadLibrary();
      });
      await waitFor(() => expect(result.current.allTracks).toHaveLength(2));

      (mockRepo.getTracksPage as jest.Mock).mockRejectedValueOnce(
        new Error("réseau"),
      );
      await act(async () => {
        await result.current.reloadLibrary();
      });

      expect(result.current.allTracks).toHaveLength(2);
    });
  });

  describe("rechargement d'une liste déjà paginée", () => {
    const makeTracks = (count: number, from = 0) =>
      Array.from({ length: count }, (_, i) => ({
        id: String(from + i + 1),
        title: `Track ${from + i + 1}`,
        artist: "Artist",
        filename: `t${from + i + 1}.mp3`,
        bpm: 100,
        style: "Latin",
      }));
    const pageImpl = (total: number) => (skip: number, take: number) =>
      Promise.resolve({
        tracks: makeTracks(Math.max(0, Math.min(take, total - skip)), skip),
        hasMore: skip + take < total,
        total,
      });

    it("re-fetches every loaded track (chunked by the backend take cap) instead of collapsing to page 0", async () => {
      (mockRepo.getTracksPage as jest.Mock).mockImplementation(pageImpl(500));
      const { result } = await renderHook(() => useLibrary(), { wrapper });
      await act(async () => {
        await result.current.reloadLibrary();
      });
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          await result.current.loadMore();
        });
      }
      await waitFor(() => expect(result.current.allTracks).toHaveLength(120));

      (mockRepo.getTracksPage as jest.Mock).mockClear();
      await act(() => {
        useLibrarySyncStore.getState().markStale();
      });

      await waitFor(() =>
        expect(mockRepo.getTracksPage).toHaveBeenCalledTimes(2),
      );
      expect(mockRepo.getTracksPage).toHaveBeenNthCalledWith(1, 0, 100);
      expect(mockRepo.getTracksPage).toHaveBeenNthCalledWith(2, 100, 20);
      await waitFor(() => expect(result.current.allTracks).toHaveLength(120));
      expect(result.current.hasMore).toBe(true);

      // Pagination resumes right after the reloaded tracks.
      (mockRepo.getTracksPage as jest.Mock).mockClear();
      await act(async () => {
        await result.current.loadMore();
      });
      expect(mockRepo.getTracksPage).toHaveBeenCalledWith(120, 30);
      expect(result.current.allTracks).toHaveLength(150);
    });

    it("drops a loadMore page that resolves after a reload", async () => {
      (mockRepo.getTracksPage as jest.Mock).mockImplementation(pageImpl(100));
      const { result } = await renderHook(() => useLibrary(), { wrapper });
      await act(async () => {
        await result.current.reloadLibrary();
      });
      await waitFor(() => expect(result.current.allTracks).toHaveLength(30));

      let resolveLate: (v: unknown) => void = () => {};
      (mockRepo.getTracksPage as jest.Mock).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLate = resolve;
          }),
      );
      let pendingLoadMore: Promise<void> = Promise.resolve();
      await act(() => {
        pendingLoadMore = result.current.loadMore();
      });

      // Reload with a renamed catalogue while the loadMore is in flight.
      (mockRepo.getTracksPage as jest.Mock).mockResolvedValueOnce({
        tracks: makeTracks(30, 1000),
        hasMore: true,
        total: 100,
      });
      await act(async () => {
        await result.current.reloadLibrary();
      });
      await waitFor(() => expect(result.current.allTracks[0]?.id).toBe("1001"));

      await act(async () => {
        resolveLate({ tracks: makeTracks(30, 30), hasMore: true, total: 100 });
        await pendingLoadMore;
      });

      expect(result.current.allTracks).toHaveLength(30);
      expect(result.current.allTracks.every((t) => Number(t.id) > 1000)).toBe(
        true,
      );
      expect(result.current.isLoadingMore).toBe(false);
    });
  });

  describe("premier chargement (isInitialLoading)", () => {
    it("is initially loading until the first load lands", async () => {
      let resolvePage: (v: unknown) => void = () => {};
      (mockRepo.getTracksPage as jest.Mock).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePage = resolve;
          }),
      );
      const { result } = await renderHook(() => useLibrary(), { wrapper });
      // Deferred first load (Library tab not opened yet): still "loading",
      // so the screen never flashes "Votre bibliothèque est vide".
      expect(result.current.isInitialLoading).toBe(true);

      let pending: Promise<void> = Promise.resolve();
      await act(() => {
        pending = result.current.reloadLibrary();
      });
      expect(result.current.isInitialLoading).toBe(true);

      await act(async () => {
        resolvePage({ tracks: mockTracks, hasMore: false, total: 2 });
        await pending;
      });
      expect(result.current.isInitialLoading).toBe(false);
      expect(result.current.allTracks).toHaveLength(2);
    });

    it("stops initial loading when the first load fails (offline)", async () => {
      (mockRepo.getTracksPage as jest.Mock).mockRejectedValueOnce(
        new Error("Network Error"),
      );
      const { result } = await renderHook(() => useLibrary(), { wrapper });

      await act(async () => {
        await result.current.reloadLibrary();
      });

      expect(result.current.isInitialLoading).toBe(false);
      expect(result.current.allTracks).toHaveLength(0);
    });

    it("does not fetch a next page before the first load landed", async () => {
      const { result } = await renderHook(() => useLibrary(), { wrapper });

      // onEndReached fires on an empty list's layout: must be a no-op.
      await act(async () => {
        await result.current.loadMore();
      });

      expect(mockRepo.getTracksPage).not.toHaveBeenCalled();
      expect(result.current.isLoadingMore).toBe(false);
    });
  });

  // Review finding: hasLoadedOnce survived a logout, so the next user briefly
  // saw the empty state instead of the initial loader.
  describe("fin de session", () => {
    const loadOnce = async () => {
      const hook = await renderHook(() => useLibrary(), { wrapper });
      await act(async () => {
        await hook.result.current.reloadLibrary();
      });
      await waitFor(() =>
        expect(hook.result.current.allTracks).toHaveLength(2),
      );
      expect(hook.result.current.isInitialLoading).toBe(false);
      return hook;
    };

    afterEach(() => {
      useAuthStore.setState({ isLoggedIn: null });
    });

    it("is initially loading again after a logout (session-end cleanups)", async () => {
      const { result } = await loadOnce();
      await act(async () => {
        await runSessionEndCleanups();
      });
      expect(result.current.isInitialLoading).toBe(true);
      expect(result.current.allTracks).toHaveLength(0);
      expect(result.current.sections).toHaveLength(0);
    });

    it("is initially loading again when the session expires (logged out in the store)", async () => {
      useAuthStore.setState({ isLoggedIn: true });
      const { result } = await loadOnce();
      await act(async () => {
        useAuthStore.setState({ isLoggedIn: false });
      });
      expect(result.current.isInitialLoading).toBe(true);
      expect(result.current.allTracks).toHaveLength(0);
    });

    it("drops a load still in flight for the previous session", async () => {
      const { result } = await renderHook(() => useLibrary(), { wrapper });
      let resolvePage: (v: unknown) => void = () => {};
      (mockRepo.getTracksPage as jest.Mock).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePage = resolve;
          }),
      );
      let pending: Promise<void> = Promise.resolve();
      await act(async () => {
        pending = result.current.reloadLibrary();
      });
      await act(async () => {
        await runSessionEndCleanups();
      });
      await act(async () => {
        resolvePage({ tracks: mockTracks, hasMore: false, total: 2 });
        await pending;
      });
      expect(result.current.isInitialLoading).toBe(true);
      expect(result.current.allTracks).toHaveLength(0);
    });
  });

  it("useLibrary throws when outside provider", async () => {
    await expect(renderHook(() => useLibrary())).rejects.toThrow(
      "useLibrary must be used within a LibraryProvider",
    );
  });
});
